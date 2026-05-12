import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveBudgetsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { runWithEscalation } from '@goose-hub/core/agent-runtime/with-escalation.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ImplementSchema } from '@goose-hub/skills/implement/schema.js';

export interface FixFeedbackDeps {
  runtime?: AgentRuntime;
}

/**
 * Finds the worktree path from the most recent `pr.opened` event for this work item.
 * Returns undefined if no such event exists.
 */
function findWorktreePath(workItemId: string): string | undefined {
  const events = eventStore.replay({ workItemId });
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpened == null) return undefined;
  const payload = prOpened.payload as Record<string, unknown>;
  return typeof payload.worktreePath === 'string' ? payload.worktreePath : undefined;
}

type TierResult = {
  passed: boolean;
  findings: Array<{ tier: string; severity: string; description: string; suggestion?: string }>;
};

type QaPayload = {
  verdict?: string;
  overallScore?: number;
  threshold?: number;
  tierResults?: {
    structural?: TierResult;
    functional?: TierResult;
    regression?: TierResult;
  };
};

type ReviewPayload = {
  verdict?: string;
  findings?: Array<{ severity: string; description: string }>;
};

/**
 * Finds the most recent failure from either `qa.completed` (non-pass) or
 * `review.completed` (needs-fix), whichever is later in the event stream,
 * and formats it as advisor feedback for the implement skill.
 *
 * Skips QA passes so a qa-fail → fix → qa-pass → review-fail cycle correctly
 * surfaces the review findings rather than the superseded QA pass.
 */
function buildAdvisorFeedback(workItemId: string): string {
  const events = eventStore.replay({ workItemId });

  let qaIdx = -1;
  let qaEvent: (typeof events)[number] | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'qa.completed' && (e.payload as QaPayload).verdict !== 'pass') {
      qaIdx = i;
      qaEvent = e;
      break;
    }
  }

  let reviewIdx = -1;
  let reviewEvent: (typeof events)[number] | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'review.completed' && (e.payload as ReviewPayload).verdict === 'needs-fix') {
      reviewIdx = i;
      reviewEvent = e;
      break;
    }
  }

  if (reviewEvent != null && reviewIdx > qaIdx) {
    const payload = reviewEvent.payload as ReviewPayload;
    const findings = payload.findings ?? [];
    const lines: string[] = ['Review verdict: needs-fix', '', 'Findings to address:'];
    for (const f of findings) {
      lines.push(`- [${f.severity}] ${f.description}`);
    }
    return lines.join('\n');
  }

  if (qaEvent != null) {
    const payload = qaEvent.payload as QaPayload;
    const { verdict = 'fail', overallScore = 0, threshold = 70, tierResults = {} } = payload;
    const lines: string[] = [
      `QA verdict: ${verdict} (score ${overallScore}/${threshold})`,
      '',
      'Findings to address:',
    ];
    for (const [tier, result] of Object.entries(tierResults) as [
      string,
      TierResult | undefined,
    ][]) {
      if (result == null || result.passed) continue;
      for (const f of result.findings) {
        lines.push(
          `- [${tier}/${f.severity}] ${f.description}${f.suggestion ? ` — ${f.suggestion}` : ''}`,
        );
      }
    }
    return lines.join('\n');
  }

  return '';
}

/**
 * Runs the fix-feedback workflow for a work item in `factory:needs-fix` state.
 *
 * This workflow is invoked after QA fails and auto-transition has moved the
 * item from `factory:qa-failed` → `factory:needs-fix`. It differs from
 * fix-issue in that:
 * - It reuses the existing worktree (no new worktree created)
 * - It injects QA findings as `advisorFeedback` for the implement skill
 * - It pushes to the existing branch (no new PR opened)
 *
 * Sequence:
 *   1. Find existing worktree from `pr.opened` event → missing = needs-human
 *   2. Transition factory:needs-fix → factory:in-progress
 *   3. Run implement skill with QA findings as advisorFeedback, revisionPass=1
 *   4. Emit agent.fix-feedback-complete
 *   5. Transition factory:in-progress → factory:needs-qa
 *
 * On failure at any step: comment, transition to factory:needs-human.
 */
export async function runFixFeedbackWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  _targetRepo: string,
  deps: FixFeedbackDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const projectConfig = await getProjectBySlug(projectId);

  const worktreePath = findWorktreePath(workItem.id);
  if (worktreePath == null) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Failed',
        'No worktree found — cannot locate existing dev workspace, escalating to needs-human',
      ),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-fix',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:needs-fix',
      to: 'factory:needs-human',
      by: 'fix-feedback',
      runId,
    });
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: 'fix-feedback: no worktree found in pr.opened events' },
      runId,
    });
    return;
  }

  const implementPrompt = readPromptWithContext('implement', projectId);
  const implementJsonSchema = toJsonSchema(ImplementSchema);
  const { personaId } = selectPersona(projectId, 'developer');
  const advisorFeedback = buildAdvisorFeedback(workItem.id);

  await stateSource.transitionState(
    workItem.externalId,
    'factory:needs-fix',
    'factory:in-progress',
  );
  emitStateTransitionEvent({
    projectId,
    workItemId: workItem.id,
    from: 'factory:needs-fix',
    to: 'factory:in-progress',
    by: 'fix-feedback',
    runId,
  });

  try {
    const { output: implementOutput } = await runWithEscalation({
      runtime,
      schema: ImplementSchema,
      projectId,
      workItemId: workItem.id,
      projectBudgets: projectConfig?.budgets,
      spec: {
        runId,
        role: 'developer',
        skill: 'implement',
        workspaceDir: worktreePath,
        context: {
          projectId,
          workItemId: workItem.id,
          workItem: {
            title: workItem.title,
            body: workItem.body,
            number: Number(workItem.externalId),
            priority: workItem.priority,
          },
          worktreePath,
          stack: {
            testCommand: 'pnpm test',
            lintCommand: 'pnpm lint',
            typecheckCommand: 'pnpm typecheck',
          },
          advisorFeedback: advisorFeedback || undefined,
          revisionPass: 1,
        },
        contextAllowlist: [
          'workItem.title',
          'workItem.body',
          'workItem.number',
          'workItem.priority',
          'worktreePath',
          'stack.testCommand',
          'stack.lintCommand',
          'stack.typecheckCommand',
          'advisorFeedback',
          'revisionPass',
        ],
        freshContext: false,
        toolBundles: ['dev-tools'],
        toolExtras: [],
        ...resolveBudgetsForProject('implement', projectConfig?.budgets, projectId),
        personaId,
        outputJsonSchema: implementJsonSchema,
        appendSystemPrompt: implementPrompt,
      },
    });

    reconcileDecisionSummaries(
      runId,
      projectId,
      workItem.id,
      'fix-feedback',
      implementOutput.decisionSummaries,
    );

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.fix-feedback-complete',
      payload: {
        filesWritten: implementOutput.filesWritten.length,
        testsWritten: implementOutput.testsWritten.length,
        confidence: implementOutput.confidence,
        testsRun: implementOutput.testsRun,
      },
      runId,
    });

    accumulatePersonaStats({ personaName: personaId, role: 'developer', outcome: 'success' });

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Complete', 'Fix-feedback applied — transitioning to needs-qa'),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-qa',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:in-progress',
      to: 'factory:needs-qa',
      by: 'fix-feedback',
      runId,
    });
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'developer', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Failed', 'Fix-feedback failed — escalating to needs-human', [
        `Error: ${error.message}`,
      ]),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:in-progress',
      to: 'factory:needs-human',
      by: 'fix-feedback',
      runId,
    });
  }
}
