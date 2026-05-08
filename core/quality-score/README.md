# core/quality-score

Per-run QualityScore (0–100) with components and convergence detection.

## What it does

Computes a ship-readiness score for each agent run based on pipeline outputs.
Persists scores to the `run_quality_scores` SQLite table for trend analysis.
Detects convergence across the last three iterations (Steve's rule).

## API

### `computeQualityScore(runArtifacts: RunArtifacts): { score: number; components: QualityComponents }`

Computes the 0–100 score from `QualityComponents`. A P0 finding immediately
returns `score: 0`. See `docs/adr/0033-quality-score-weights.md` for the
weight rationale.

### `isConverged(scoreHistory: number[], latestComponents): boolean`

Returns true when the last 3 scores are within a 5-point delta AND the most
recent run has zero P0/P1 findings. Implements Steve's convergence rule
verbatim (`08-learning-convergence-loop.md:130-145`).

### `persistRunQualityScore(input)` / `listRunQualityScores(runId)` / `listProjectQualityTrend(projectId)`

Repository functions for the `run_quality_scores` table.

## Schema

`QualityComponents` (snake_case, matches Steve verbatim):

| Field             | Type    | Source                       |
|-------------------|---------|------------------------------|
| p0_count          | int     | QA / review findings         |
| p1_count          | int     | QA / review findings         |
| p2_count          | int     | QA / review findings         |
| p3_count          | int     | QA / review findings         |
| regressions_open  | int     | Tier-3 regression gate       |
| review_converged  | bool    | Reviewer verdict             |
| uat_passed        | bool    | Tier-2 functional verify     |
| static_passed     | bool    | Tier-1 structural verify     |
| harness_pass_rate | 0–1     | Test runner pass ratio       |

`audit_score` (from code-quality-audit #564) is stored separately at the row
level and does NOT feed `computeQualityScore`.

## Autonomous-mode gate

In supervised mode the score is informational only. In autonomous mode (M16)
PR auto-merge requires `score >= 80 AND isConverged(history)`.
