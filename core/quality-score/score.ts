// core/quality-score/score.ts
// Per-run QualityScore (0-100) with convergence detection.
// Formula weights are documented in docs/adr/0033-quality-score-weights.md.
// Steve source: 03-lifecycle-harness.md:159-177, 08-learning-convergence-loop.md:88-145.

import type { QualityComponents, RunArtifacts } from './types.js';

// Weights — see ADR 0033 for rationale.
const WEIGHTS = {
  base: 20,
  harness: 30,
  staticPassed: 20,
  uatPassed: 20,
  reviewConverged: 10,
  p1Deduction: 8,
  p2Deduction: 4,
  p3Deduction: 1,
  regressionDeduction: 5,
} as const;

export function computeQualityScore(runArtifacts: RunArtifacts): {
  score: number;
  components: QualityComponents;
} {
  const { components } = runArtifacts;

  // P0 finding immediately zeros the score (Steve: "P0 zeroes the score").
  if (components.p0_count > 0) {
    return { score: 0, components };
  }

  let score = WEIGHTS.base;
  score += components.harness_pass_rate * WEIGHTS.harness;
  if (components.static_passed) score += WEIGHTS.staticPassed;
  if (components.uat_passed) score += WEIGHTS.uatPassed;
  if (components.review_converged) score += WEIGHTS.reviewConverged;

  score -= components.p1_count * WEIGHTS.p1Deduction;
  score -= components.p2_count * WEIGHTS.p2Deduction;
  score -= components.p3_count * WEIGHTS.p3Deduction;
  score -= components.regressions_open * WEIGHTS.regressionDeduction;

  return { score: Math.round(Math.max(0, Math.min(100, score))), components };
}

// isConverged implements Steve's rule verbatim (08-learning-convergence-loop.md:130-145):
//   scoreHistory.length >= 3
//   AND (max(last 3) - min(last 3)) < 5.0
//   AND p0_count + p1_count === 0
//
// latestComponents must be the components from the most recent run in scoreHistory.
export function isConverged(
  scoreHistory: number[],
  latestComponents: Pick<QualityComponents, 'p0_count' | 'p1_count'>,
): boolean {
  if (scoreHistory.length < 3) return false;
  const last3 = scoreHistory.slice(-3);
  const delta = Math.max(...last3) - Math.min(...last3);
  return delta < 5.0 && latestComponents.p0_count + latestComponents.p1_count === 0;
}
