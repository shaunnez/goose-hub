import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateQa } from '@goose-hub/core/retry/retry-counter.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { QaOutputSchema } from '@goose-hub/skills/qa/schema.js';

const REPO_ROOT = join(import.meta.dirname, '../..');

function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'skill.md'), 'utf8');
}

/**
 * Placeholder — real PR diff fetch is M9+ scope.
 * Returns empty string; QA grades on test results.
 */
function getPrDiff(_workItem: WorkItem): string {
  return '';
}

export interface QaWorkflowDeps {
  runtime?: AgentRuntime;
}

/**
 * Runs the QA workflow for a work item in `factory:needs-qa` state.
 *
 * Workflow:
 * 1. Run the `qa` skill (QA holdout agent, sonnet-tier)
 * 2. Validate output against QaOutputSchema
 * 3. Emit `qa.completed` event
 * 4. Emit `agent.decision-summary` for each decision summary
 * 5. Post a comment summarizing verdict and score
 * 6. Transition state:
 *    - pass or partial≥70 → factory:needs-review
 *    - fail or partial<70 → factory:qa-failed
 *
 * On failure: persist agent.run-failed event, post comment,
 * transition to factory:needs-human.
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
  const qaPrompt = readPrompt('qa');
  const qaJsonSchema = toJsonSchema(QaOutputSchema);
  const personaId = selectPersona(projectId, 'qa');
  const prDiff = getPrDiff(workItem);

  try {
    // Run the QA skill
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
          testCommand: 'pnpm test --run',
          lintCommand: 'pnpm biome check .',
        },
      },
      contextAllowlist: ['workItem', 'prDiff', 'projectCommands'],
      freshContext: true,
      toolBundles: ['read', 'shell', 'validate'],
      toolExtras: [],
      budgets: { maxTurns: 50, maxBudgetUsd: 0.5, timeoutMs: 300_000 },
      personaId,
      outputJsonSchema: qaJsonSchema,
      appendSystemPrompt: qaPrompt,
    });

    // Validate output
    const qaParsed = QaOutputSchema.safeParse(qaResult.output);
    if (!qaParsed.success) {
      throw new Error(`QA output validation failed: ${JSON.stringify(qaParsed.error.issues)}`);
    }
    const qaOutput = qaParsed.data;

    // Emit qa.completed event
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'qa.completed',
      payload: {
        verdict: qaOutput.verdict,
        overallScore: qaOutput.overallScore,
        tierResults: qaOutput.tierResults,
      },
      runId,
    });

    // Emit agent.decision-summary for each decision summary in output
    for (const summary of qaOutput.decisionSummaries) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.decision-summary',
        payload: { skill: 'qa', ...summary },
        runId,
      });
    }

    // Determine next state
    const passes =
      qaOutput.verdict === 'pass' ||
      (qaOutput.verdict === 'partial' && qaOutput.overallScore >= 70);

    let nextState: StateName;
    if (passes) {
      nextState = 'factory:needs-review';
    } else {
      // Check retry count using events already in the store (including the one just appended)
      const existingEvents = eventStore.replay({ workItemId: workItem.id });
      const needsEscalation = shouldEscalateQa(existingEvents);
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

    // Post summary comment
    const scoreLabel = `${qaOutput.overallScore}/${qaOutput.threshold}`;
    const comment = `**QA ${qaOutput.verdict}** — score ${scoreLabel}\n\nVerdict: ${qaOutput.verdict} → ${nextState}`;
    await stateSource.comment(workItem.externalId, comment);

    // Transition state
    await stateSource.transitionState(workItem.externalId, 'factory:needs-qa', nextState);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Persist failure event
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });

    // Post GitHub comment
    await stateSource.comment(workItem.externalId, `QA failed: ${error.message}`);

    // Transition to error state
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-qa',
      'factory:needs-human',
    );
  }
}
