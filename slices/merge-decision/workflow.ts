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

  persistRunQualityScore({
    runId,
    pipelineRunId: input.pipelineRunId,
    projectId: input.projectId,
    iteration,
    score,
    components,
  });

  // Read prior scores (ascending by ts). `listProjectQualityTrend` already
  // returns ascending — but we exclude the row we just wrote.
  const trend = listProjectQualityTrend(input.projectId);
  const priorScores = trend
    .filter((r) => r.pipelineRunId !== input.pipelineRunId)
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

export { getLatestQualityScoreByPipelineRun };
