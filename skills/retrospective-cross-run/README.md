# retrospective-cross-run skill

Cross-run retrospective analysis: mines patterns from archived lifecycles, computes gate thresholds and cost baselines, exports a PlaybookManifest for reuse.

## Purpose

The fast path (per-run) retrospective-deep and retrospective-light skills produce per-run analysis. This skill is the **analytical path** that runs across many lifecycles to answer:

- What patterns emerged consistently across runs?
- What are the learned gate pass thresholds?
- What are typical costs per role-skill pair?
- What systemic improvements would compound impact?

The output is a `PlaybookManifest` — a portable bundle of learnings, patterns, and baselines that can be imported into new projects for day-1 quality.

## Context

- `projectId` — identifies the target project
- `windowStartAt` / `windowEndAt` — ISO 8601 time window for analysis
- `lifecycleCount` — how many archived lifecycles exist in the window (0+ means empty archive is valid)
- `sampleRetroOutputs` — representative retrospective JSON objects from within the window
- `historicalGateScores` — raw gate pass scores per gate, collected across the window
- `historicalCosts` — raw costs per (role, skill), collected across the window

## Output

`CrossRunRetroOutput`:
- `windowStartAt`, `windowEndAt` — echoed from input
- `lifecycleCount` — echoed
- `aggregatedLearnings[]` — unique observations, counted and ranked by occurrence
- `topPatterns[]` — decision patterns mined from samples, with consistency scores
- `gateThresholds[]` — computed mean/min/max/stdDev per gate
- `costBaselines[]` — computed mean/p50/p95 per (role, skill)
- `improvementCandidates[]` — high-confidence, actionable improvements
- `summary` — what went well, what didn't, architectural takeaway
- `decisionSummaries[]` — at least one VERDICT summarising the analysis
- `outcome` — "success" | "failure" | "partial"

## Convergence

Learnings and patterns are surfaced as "converged" (high confidence) only if they appear in ≥3 samples or across ≥3 lifecycle boundaries. Single-run observations are rejected in favour of cross-run signal.

## Edge cases

- **Empty archive (lifecycleCount === 0):** Return valid output with empty aggregations. Useful to bootstrap a new project.
- **Single lifecycle:** Still computes gate thresholds and costs; patterns and learnings may be thin.
- **All gates passed:** gateThresholds populated with 1.0 mean scores (still useful for baselines).
- **No cost data:** costBaselines returns empty array.

## Import ceremony

The orchestrator's `cross-run-retro` workflow persists the output to the `playbooks` table. The Roster UI lists playbooks per project with drill-in to manifest detail.
