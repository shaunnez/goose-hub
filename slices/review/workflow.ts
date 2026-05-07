import { execSync } from 'node:child_process';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { resolveBudgets } from '@goose-hub/core/agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateReview } from '@goose-hub/core/retry/retry-counter.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ReviewOutputSchema } from '@goose-hub/skills/review/schema.js';

export interface ReviewWorkflowDeps {
  runtime?: AgentRuntime;
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
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const reviewPrompt = readPromptWithContext('review', projectSlug);
  const reviewJsonSchema = toJsonSchema(ReviewOutputSchema);
  const { personaId } = selectPersona(projectSlug, 'reviewer');

  // Snapshot prior events BEFORE this run's outcome is appended (same pattern as QA workflow).
  const priorEvents = eventStore.replay({ workItemId: workItem.id });

  try {
    const prDiff = await getPrDiff(workItem, stateSource);
    const qaVerdict = getQaVerdict(priorEvents);

    const result = await runtime.run({
      runId,
      role: 'reviewer',
      skill: 'review',
      context: {
        projectId: projectSlug,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        prDiff,
        qaVerdict,
      },
      contextAllowlist: ['workItem', 'prDiff', 'qaVerdict'],
      freshContext: true,
      toolBundles: ['read', 'validate'],
      toolExtras: [],
      ...resolveBudgets('review', projectConfig?.budgets),
      personaId,
      outputJsonSchema: reviewJsonSchema,
      appendSystemPrompt: reviewPrompt,
    });

    const parsed = ReviewOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`Review output validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    const reviewOutput = parsed.data;

    const { decisionSummaries: _ds, ...reviewPayload } = reviewOutput;
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'review.completed',
      payload: reviewPayload,
      runId,
    });

    for (const summary of reviewOutput.decisionSummaries) {
      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'agent.decision-summary',
        payload: { skill: 'review', ...summary },
        runId,
      });
    }

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
      const VERDICT_TO_STATE: Record<string, StateName> = {
        approved: 'factory:approved',
        'needs-human': 'factory:needs-human',
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
    await stateSource.transitionState(workItem.externalId, 'factory:needs-review', nextState);
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
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-review',
      'factory:needs-human',
    );
  }
}

async function getPrDiff(workItem: WorkItem, stateSource: StateSource): Promise<string> {
  if ('getPrDiff' in stateSource && typeof stateSource.getPrDiff === 'function') {
    return (stateSource.getPrDiff as (id: string) => Promise<string>)(workItem.externalId);
  }
  // Fall back to reading prNumber from the pr.opened event and shelling out to gh.
  const events = eventStore.replay({ workItemId: workItem.id });
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpened == null) return '';
  const payload = prOpened.payload as Record<string, unknown>;
  const prNumber = typeof payload.prNumber === 'number' ? payload.prNumber : undefined;
  if (prNumber == null) return '';
  try {
    return execSync(`gh pr diff ${prNumber}`, { encoding: 'utf8', timeout: 30_000 });
  } catch {
    return '';
  }
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
