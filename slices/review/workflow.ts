import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveProjectAgentExecution } from '@goose-hub/core/agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateReview } from '@goose-hub/core/retry/retry-counter.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ReviewOutputSchema } from '@goose-hub/skills/review/schema.js';
import type { ReviewVerdict } from '@goose-hub/skills/review/schema.js';

import { buildReviewSpec } from './review-spec.js';

export type { FindingKey, ReviewWaveResult, DispatchReviewWaveOpts } from './review-spec.js';
export { dispatchReviewWave, runConvergentReviewWorkflow } from './convergent-review.js';

export interface ReviewWorkflowDeps {
  runtime?: AgentRuntime;
}

function findPipelineRunId(projectId: string, workItemId: string): string | undefined {
  // Scope by both projectId and workItemId — two projects can track the same
  // upstream issue, and we must not attach another project's pipelineRunId
  // to this review's event payload.
  const events = eventStore.replay({ projectId, workItemId });
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  const payload = prOpened?.payload as { pipelineRunId?: string } | undefined;
  return typeof payload?.pipelineRunId === 'string' ? payload.pipelineRunId : undefined;
}

async function transitionReviewState(input: {
  stateSource: StateSource;
  workItem: WorkItem;
  projectSlug: string;
  to: StateName;
  by: string;
  runId?: string;
}): Promise<void> {
  await input.stateSource.transitionState(
    input.workItem.externalId,
    'factory:needs-review',
    input.to,
  );
  emitStateTransitionEvent({
    projectId: input.projectSlug,
    workItemId: input.workItem.id,
    from: 'factory:needs-review',
    to: input.to,
    by: input.by,
    ...(input.runId != null ? { runId: input.runId } : {}),
  });
}

/**
 * Runs the Review holdout workflow for a work item in `factory:needs-review` state.
 * Reviewer is a holdout: fresh context, no advisor, no fallback (FACTORY_RULES 1, 20, 23).
 *
 * State transitions:
 *   factory:needs-review → factory:approved   (verdict: approved)
 *   factory:needs-review → factory:needs-fix  (verdict: needs-fix)
 *   factory:needs-review → factory:needs-human (verdict: needs-human OR runtime error)
 */
export async function runReviewWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectSlug: string,
  _targetRepo: string,
  deps: ReviewWorkflowDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const projectConfig = await getProjectBySlug(projectSlug);
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: 'review',
    role: 'reviewer',
    projectId: projectSlug,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
  const reviewPrompt = readPromptWithContext('review', projectSlug);
  const reviewJsonSchema = toJsonSchema(ReviewOutputSchema);
  const { personaId } = selectPersona(projectSlug, 'reviewer');

  // Snapshot prior events BEFORE this run's outcome is appended (same pattern as QA workflow).
  const priorEvents = eventStore.replay({ workItemId: workItem.id });

  try {
    const prDiff = await getPrDiff(workItem, stateSource);
    const qaVerdict = getQaVerdict(priorEvents);

    const spec = buildReviewSpec({
      runId,
      projectSlug,
      workItem,
      prDiff,
      qaResult: qaVerdict,
      personaId,
      reviewPrompt,
      reviewJsonSchema,
      resolvedBudgets: resolvedBudget,
    });
    const result = await runtime.run(spec);

    const parsed = ReviewOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`Review output validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    const reviewOutput = parsed.data;

    const { decisionSummaries: _ds, ...reviewPayload } = reviewOutput;
    const pipelineRunId = findPipelineRunId(projectSlug, workItem.id);
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'review.completed',
      payload: { ...reviewPayload, ...(pipelineRunId != null ? { pipelineRunId } : {}) },
      runId,
    });

    reconcileDecisionSummaries(
      runId,
      projectSlug,
      workItem.id,
      'review',
      reviewOutput.decisionSummaries,
    );

    let nextState: StateName;
    if (reviewOutput.verdict === 'needs-fix') {
      // Use priorEvents (snapshotted before this run) for retry count.
      const needsEscalation = shouldEscalateReview(priorEvents);
      nextState = needsEscalation ? 'factory:needs-human' : 'factory:needs-fix';
      if (needsEscalation) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'agent.retry-escalated',
          payload: { stage: 'review', maxRetries: DEFAULT_MAX_RETRIES, runId },
          runId,
        });
      }
    } else {
      // verdict is narrowed to Exclude<ReviewVerdict, 'needs-fix'> here, but
      // the lookup map covers the full union for defence-in-depth — if a new
      // verdict literal is added to the schema, TypeScript flags this branch.
      const VERDICT_TO_STATE: Record<ReviewVerdict, StateName> = {
        approved: 'factory:approved',
        'needs-human': 'factory:needs-human',
        'needs-fix': 'factory:needs-fix',
      };
      nextState = VERDICT_TO_STATE[reviewOutput.verdict] ?? 'factory:needs-human';
    }

    const comment = buildReviewComment(reviewOutput, nextState);
    await stateSource.comment(workItem.externalId, comment);

    accumulatePersonaStats({
      personaName: personaId,
      role: 'reviewer',
      outcome: reviewOutput.verdict === 'approved' ? 'success' : 'failure',
      qualityScore: reviewOutput.confidence,
    });
    await transitionReviewState({
      stateSource,
      workItem,
      projectSlug,
      to: nextState,
      by: 'review',
      runId,
    });
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'reviewer', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message, skill: 'review' },
      runId,
    });

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Review', 'Failed', 'Review run failed — escalating to needs-human', [
        `Error: ${error.message}`,
      ]),
    );
    await transitionReviewState({
      stateSource,
      workItem,
      projectSlug,
      to: 'factory:needs-human',
      by: 'review',
      runId,
    });
  }
}

async function getPrDiff(workItem: WorkItem, stateSource: StateSource): Promise<string> {
  return stateSource.getPrDiff(workItem.externalId);
}

function getQaVerdict(
  events: { kind: string; payload: string | unknown }[],
): { verdict: string; overallScore: number } | undefined {
  const qaEvents = events.filter((e) => e.kind === 'qa.completed');
  if (qaEvents.length === 0) return undefined;
  const last = qaEvents[qaEvents.length - 1];
  const p = (typeof last.payload === 'string' ? JSON.parse(last.payload) : last.payload) as {
    verdict?: string;
    overallScore?: number;
  };
  if (p.verdict == null || p.overallScore == null) return undefined;
  return { verdict: p.verdict, overallScore: p.overallScore };
}

function buildReviewComment(
  output: {
    verdict: string;
    confidence: number;
    criteriaChecks: Array<{ criterion: string; status: string }>;
    findings: Array<{ severity: string; description: string }>;
  },
  nextState: string,
): string {
  const statusMap: Record<string, string> = {
    approved: 'Approved',
    'needs-fix': 'Needs Fix',
    'needs-human': 'Needs Human',
  };
  const status = statusMap[output.verdict] ?? output.verdict;
  const pct = Math.round(output.confidence * 100);
  const details = [
    ...output.criteriaChecks.map((c) => `[${c.status === 'met' ? 'x' : ' '}] ${c.criterion}`),
    ...output.findings.slice(0, 5).map((f) => `[${f.severity}] ${f.description}`),
  ];
  return buildAgentComment(
    'Review',
    status,
    `Confidence ${pct}% — transitioning to ${nextState}`,
    details.length > 0 ? details : undefined,
  );
}
