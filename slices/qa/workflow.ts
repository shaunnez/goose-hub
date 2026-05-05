import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateQa } from '@goose-hub/core/retry/retry-counter.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { runVitest } from '@goose-hub/core/test-runner/run-vitest.js';
import { QaOutputSchema, type TestRun } from '@goose-hub/skills/qa/schema.js';

// M9+ will fetch the real diff from GitHub. Until then QA grades on test/lint results only.
function getPrDiff(_workItem: WorkItem): string {
  return '';
}

function findDevWorktreePath(workItemId: string): string | undefined {
  const events = eventStore.replay({ workItemId });
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpened == null) return undefined;
  const payload = prOpened.payload as Record<string, unknown>;
  return typeof payload.worktreePath === 'string' ? payload.worktreePath : undefined;
}

export interface QaWorkflowDeps {
  runtime?: AgentRuntime;
  /**
   * Override for the test runner. Default uses `runVitest` against the
   * configured test command. Pass a stub in tests to avoid spawning.
   * Returning `null` (or throwing) is treated as "no testRun data" — the
   * QA agent still runs, just without real suite numbers in its context.
   */
  runTests?: (cwd: string, command: string) => Promise<TestRun | null>;
}

const DEFAULT_TEST_COMMAND = 'pnpm test --run';

async function defaultRunTests(cwd: string, command: string): Promise<TestRun | null> {
  try {
    return await runVitest({ command, cwd });
  } catch {
    return null;
  }
}

/**
 * Runs the QA holdout workflow for a work item in `factory:needs-qa` state.
 * QA is a holdout: fresh context, no advisor, no fallback (FACTORY_RULES 1, 20, 23).
 *
 * Workflow:
 * 1. Snapshot existing events (for retry counting — read BEFORE appending outcome)
 * 2. Run the `qa` skill
 * 3. Emit tier-specific failure events (qa.structural-failed etc.) for failed tiers
 * 4. Emit `qa.completed` with full payload including qualityScores
 * 5. Emit `agent.decision-summary` per entry
 * 6. Determine next state using pre-run snapshot for retry count
 *    - pass or partial≥70 → factory:needs-review
 *    - fail or partial<70, retries < maxRetries → factory:qa-failed
 *    - fail or partial<70, retries >= maxRetries → factory:needs-human
 *
 * On runtime error: emit agent.run-failed, comment, transition to factory:needs-human.
 */
export async function runQaWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  _targetRepo: string,
  deps: QaWorkflowDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const runTests = deps.runTests ?? defaultRunTests;
  const qaPrompt = readPromptWithContext('qa', projectId);
  const qaJsonSchema = toJsonSchema(QaOutputSchema);
  const { personaId } = selectPersona(projectId, 'qa');
  const prDiff = getPrDiff(workItem);
  const workspaceDir = findDevWorktreePath(workItem.id);

  // Snapshot prior events BEFORE this run's outcome is appended.
  // shouldEscalateQa uses this count to decide: Nth failure = N-1 priors.
  const priorEvents = eventStore.replay({ workItemId: workItem.id });

  // Run tests deterministically before invoking the QA agent so the agent
  // grades against real numbers instead of re-running the suite. Failures
  // here are non-fatal — the agent still runs without testRun.
  const testCommand = DEFAULT_TEST_COMMAND;
  const testRun = workspaceDir != null ? await runTests(workspaceDir, testCommand) : null;

  try {
    const qaResult = await runtime.run({
      runId,
      role: 'qa',
      skill: 'qa',
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        prDiff,
        projectCommands: {
          testCommand,
          lintCommand: 'pnpm biome check .',
        },
        testRun,
      },
      contextAllowlist: ['workItem', 'prDiff', 'projectCommands', 'testRun'],
      freshContext: true,
      toolBundles: ['read', 'qa-tools'],
      workspaceDir,
      toolExtras: [],
      budgets: { maxTurns: 50, maxBudgetUsd: 5, timeoutMs: 600_000 },
      personaId,
      outputJsonSchema: qaJsonSchema,
      appendSystemPrompt: qaPrompt,
    });

    const qaParsed = QaOutputSchema.safeParse(qaResult.output);
    if (!qaParsed.success) {
      throw new Error(`QA output validation failed: ${JSON.stringify(qaParsed.error.issues)}`);
    }
    const qaOutput = qaParsed.data;

    // Emit tier-specific failure events for downstream subscribers.
    const TIER_EVENTS = {
      structural: 'qa.structural-failed',
      functional: 'qa.functional-failed',
      regression: 'qa.regression-failed',
    } as const;
    for (const [tier, kind] of Object.entries(TIER_EVENTS) as [
      keyof typeof TIER_EVENTS,
      (typeof TIER_EVENTS)[keyof typeof TIER_EVENTS],
    ][]) {
      if (!qaOutput.tierResults[tier].passed) {
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind,
          payload: { tier, findings: qaOutput.tierResults[tier].findings },
          runId,
        });
      }
    }

    // Emit qa.completed with full payload (qualityScores included for UI and history).
    // testRun is the workflow-captured one (deterministic), not whatever the
    // agent might echo back — even if the schema accepts it from the agent,
    // we trust our own measurement.
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'qa.completed',
      payload: {
        verdict: qaOutput.verdict,
        overallScore: qaOutput.overallScore,
        threshold: qaOutput.threshold,
        tierResults: qaOutput.tierResults,
        qualityScores: qaOutput.qualityScores,
        ...(testRun ? { testRun } : {}),
      },
      runId,
    });

    for (const summary of qaOutput.decisionSummaries) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.decision-summary',
        payload: { skill: 'qa', ...summary },
        runId,
      });
    }

    // Determine next state. Use priorEvents (snapshotted before this run) so the
    // retry count reflects completed prior failures, not the current one.
    const passes =
      qaOutput.verdict === 'pass' ||
      (qaOutput.verdict === 'partial' && qaOutput.overallScore >= qaOutput.threshold);

    let nextState: StateName;
    if (passes) {
      nextState = 'factory:needs-review';
    } else {
      const needsEscalation = shouldEscalateQa(priorEvents);
      nextState = needsEscalation ? 'factory:needs-human' : 'factory:qa-failed';
      if (needsEscalation) {
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.retry-escalated',
          payload: { stage: 'qa', maxRetries: DEFAULT_MAX_RETRIES, runId },
          runId,
        });
      }
    }

    const scoreLabel = `${qaOutput.overallScore}/${qaOutput.threshold}`;
    await stateSource.comment(
      workItem.externalId,
      `**QA ${qaOutput.verdict}** — score ${scoreLabel}\n\nVerdict: ${qaOutput.verdict} → ${nextState}`,
    );
    accumulatePersonaStats({
      personaName: personaId,
      role: 'qa',
      outcome: passes ? 'success' : 'failure',
      qualityScore: qaOutput.overallScore / 100,
    });
    await stateSource.transitionState(workItem.externalId, 'factory:needs-qa', nextState);
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'qa', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });
    await stateSource.comment(workItem.externalId, `QA failed: ${error.message}`);
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-qa',
      'factory:needs-human',
    );
  }
}
