import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateReview } from '@goose-hub/core/retry/retry-counter.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ReviewOutputSchema } from '@goose-hub/skills/review/schema.js';

const REPO_ROOT = join(import.meta.dirname, '../..');

function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'skill.md'), 'utf8');
}

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
  projectId: string,
  _targetRepo: string,
  deps: ReviewWorkflowDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const reviewPrompt = readPrompt('review');
  const reviewJsonSchema = toJsonSchema(ReviewOutputSchema);
  const { personaId } = selectPersona(projectId, 'reviewer');

  // Snapshot prior events BEFORE this run's outcome is appended (same pattern as QA workflow).
  const priorEvents = eventStore.replay({ workItemId: workItem.id });

  try {
    const prDiff = await getPrDiff(workItem, stateSource);
    const qaVerdict = getQaVerdict(workItem);

    const result = await runtime.run({
      runId,
      role: 'reviewer',
      skill: 'review',
      context: {
        projectId,
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
      budgets: { maxTurns: 50, maxBudgetUsd: 0.5, timeoutMs: 300_000 },
      personaId,
      outputJsonSchema: reviewJsonSchema,
      appendSystemPrompt: reviewPrompt,
    });

    const parsed = ReviewOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`Review output validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    const reviewOutput = parsed.data;

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'review.completed',
      payload: { verdict: reviewOutput.verdict, confidence: reviewOutput.confidence },
      runId,
    });

    for (const summary of reviewOutput.decisionSummaries) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.decision-summary',
        payload: { skill: 'review', ...summary },
        runId,
      });
    }

    const comment = buildReviewComment(reviewOutput);
    await stateSource.comment(workItem.externalId, comment);

    let nextState: StateName;
    if (reviewOutput.verdict === 'needs-fix') {
      // Use priorEvents (snapshotted before this run) for retry count.
      const needsEscalation = shouldEscalateReview(priorEvents);
      nextState = needsEscalation ? 'factory:needs-human' : 'factory:needs-fix';
      if (needsEscalation) {
        eventStore.appendEvent({
          projectId,
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
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message, skill: 'review' },
      runId,
    });

    await stateSource.comment(workItem.externalId, `Review failed: ${error.message}`);
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
  return '';
}

function getQaVerdict(_workItem: WorkItem): { verdict: string; overallScore: number } | undefined {
  // In production, read from the qa.completed event in the event store.
  // For M8 scope: return undefined (qaVerdict is optional in ReviewContextSchema).
  return undefined;
}

function buildReviewComment(output: {
  verdict: string;
  confidence: number;
  criteriaChecks: Array<{ criterion: string; status: string }>;
  findings: Array<{ severity: string; description: string }>;
}): string {
  const emojiMap: Record<string, string> = {
    approved: '✅',
    'needs-fix': '🔧',
    'needs-human': '🆘',
  };
  const emoji = emojiMap[output.verdict] ?? '❓';
  const critLines = output.criteriaChecks
    .map((c) => `- [${c.status === 'met' ? 'x' : ' '}] ${c.criterion}`)
    .join('\n');
  const findingLines = output.findings
    .slice(0, 5)
    .map((f) => `- [${f.severity}] ${f.description}`)
    .join('\n');
  return `**Review ${emoji} ${output.verdict.toUpperCase()}** (confidence: ${Math.round(output.confidence * 100)}%)\n\n${critLines || ''}\n\n${findingLines || ''}`.trim();
}
