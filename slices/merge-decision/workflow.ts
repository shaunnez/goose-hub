import { NIGHTLY_PIPELINE_RUN_PREFIX } from '@goose-hub/core/audit/run-audit.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { buildRunArtifacts } from '@goose-hub/core/quality-score/build-artifacts.js';
import {
  getLatestQualityScoreByPipelineRun,
  listProjectQualityTrend,
  persistRunQualityScore,
} from '@goose-hub/core/quality-score/repository.js';
import { computeQualityScore, isConverged } from '@goose-hub/core/quality-score/score.js';

const SCORE_THRESHOLD = 80;
const CONVERGENCE_WARMUP_RUNS = 3;

export interface MergeDecisionInput {
  pipelineRunId: string;
  projectId: string;
  workItemId?: string | null;
  /** Optional runId for the score row — defaults to `pipelineRunId`. */
  runId?: string;
  /** Optional iteration — defaults to 0 (single row per pipeline). */
  iteration?: number;
}

export type MergeDecisionResult =
  | {
      passed: true;
      score: number;
      reason: 'score-only-pass' | 'score-plus-convergence-pass';
    }
  | {
      passed: false;
      score: number;
      reason: 'score-below-threshold' | 'not-converged';
      detail: string;
    };

/**
 * Per-cycle merge-decision gate (M19.21 #697). Called BY the approve action
 * handler, NOT auto-dispatched on the orchestrator tick. Runs deterministic
 * score assembly, persists the score, then applies the warmup-aware gate:
 *
 *   - `prior.length < 3` → score-only (`score >= 80`).
 *   - `prior.length >= 3` → score AND `isConverged(...)`.
 *
 * Returns `{ passed, score, reason }`. The caller decides what to do:
 *   pass → proceed to `mergePR` → `factory:retrospecting`.
 *   fail → skip merge → `factory:needs-human` with the reason as a comment.
 *
 * Idempotent: re-running on the same `pipelineRunId` overwrites the row via
 * the unique-index conflict target (`runId`, `iteration`). The caller is
 * expected to invoke this exactly once per approve click in supervised
 * mode; the human escape hatch (merge via GitHub UI) bypasses this gate
 * entirely.
 */
export function runMergeDecision(input: MergeDecisionInput): MergeDecisionResult {
  const runId = input.runId ?? input.pipelineRunId;
  const iteration = input.iteration ?? 0;

  const artifacts = buildRunArtifacts(input.pipelineRunId, {
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId,
    iteration,
  });

  const { score, components } = computeQualityScore(artifacts);

  // Fold in any pre-existing audit score for this pipelineRunId. The audit
  // can fire BEFORE merge-decision (parallel branch during convergent
  // review) and emits `audit.completed` events that this gate reads. Pass
  // the value explicitly to persistRunQualityScore so it's not erased.
  const auditScore = readLatestAuditScore(input.projectId, input.pipelineRunId);

  persistRunQualityScore({
    runId,
    pipelineRunId: input.pipelineRunId,
    projectId: input.projectId,
    iteration,
    score,
    components,
    ...(auditScore != null ? { auditScore } : {}),
  });

  // Read prior scores (ascending by ts). `listProjectQualityTrend` already
  // returns ascending — exclude the row we just wrote, legacy rows from
  // before migration 0022 (where `pipelineRunId` is null), and project-
  // level nightly audit rows (M19.22 #698) which don't represent merge
  // cycles and would distort convergence math.
  const trend = listProjectQualityTrend(input.projectId);
  const priorScores = trend
    .filter(
      (r) =>
        r.pipelineRunId != null &&
        r.pipelineRunId !== input.pipelineRunId &&
        !r.pipelineRunId.startsWith(NIGHTLY_PIPELINE_RUN_PREFIX),
    )
    .map((r) => r.score);

  // Score-only warmup gate.
  if (priorScores.length < CONVERGENCE_WARMUP_RUNS) {
    if (score >= SCORE_THRESHOLD) {
      return { passed: true, score, reason: 'score-only-pass' };
    }
    return {
      passed: false,
      score,
      reason: 'score-below-threshold',
      detail: `score ${score} < threshold ${SCORE_THRESHOLD} (warmup: ${priorScores.length}/${CONVERGENCE_WARMUP_RUNS} prior runs)`,
    };
  }

  // Score-plus-convergence gate. Use the latest two prior scores plus the
  // current score for the convergence window.
  if (score < SCORE_THRESHOLD) {
    return {
      passed: false,
      score,
      reason: 'score-below-threshold',
      detail: `score ${score} < threshold ${SCORE_THRESHOLD}`,
    };
  }

  const convergenceWindow = [...priorScores.slice(-2), score];
  if (!isConverged(convergenceWindow, components)) {
    return {
      passed: false,
      score,
      reason: 'not-converged',
      detail: `convergence failed across [${convergenceWindow.join(', ')}] with p0+p1 = ${
        components.p0_count + components.p1_count
      }`,
    };
  }

  return { passed: true, score, reason: 'score-plus-convergence-pass' };
}

/** Read the most recent `audit.completed` payload's `auditScore` for the
 * given pipelineRunId. Returns null when no audit ran (or only failed). */
function readLatestAuditScore(projectId: string, pipelineRunId: string): number | null {
  const events = eventStore.replay({ projectId, kind: 'audit.completed' });
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const p = e.payload as { pipelineRunId?: string; auditScore?: number } | null;
    if (p?.pipelineRunId === pipelineRunId && typeof p.auditScore === 'number') {
      return p.auditScore;
    }
  }
  return null;
}

export { getLatestQualityScoreByPipelineRun };
