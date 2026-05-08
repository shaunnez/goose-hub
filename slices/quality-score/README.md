# slices/quality-score

Slice tests for `core/quality-score/` — the per-run QualityScore (0–100)
module introduced in M19.08 (issue #565).

## What is tested

- `computeQualityScore(runArtifacts)` — formula correctness, P0 zero-out rule,
  finding deductions, boolean component contributions, harness_pass_rate
  contribution, clamping to [0, 100], golden examples from the issue spec
  (scores 82 → 84 → 85)
- `isConverged(scoreHistory, latestComponents)` — Steve's convergence rule
  verbatim (`08-learning-convergence-loop.md:130-145`): length ≥ 3, delta < 5.0,
  p0+p1 = 0; all three counter-examples from the issue spec verified

## References

- `core/quality-score/score.ts` — implementation
- `core/quality-score/types.ts` — QualityComponents, RunArtifacts
- `docs/adr/0033-quality-score-weights.md` — weight rationale
