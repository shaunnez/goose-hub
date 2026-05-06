# learning slice — cross-session learning loop foundation

Ships lifecycle archive tables, cross-run pattern miner, and convergence detector. Powers M11.12 (cross-merge retro) and M11.13 (skill-coach).

## Surfaces

- `core/learning/mine.ts` — `minePatterns({ projectId, since? })` aggregates decision summaries from archived lifecycles and upserts decision patterns
- `core/learning/convergence.ts` — `computeTrend({ projectId, role, skill?, windowSize? })` detects quality score trend (improving | stable | declining)
- `core/db/schema.ts` — `archived_lifecycles` and `decision_patterns` tables
- `POST /api/projects/:slug/learning/mine` — on-demand pattern mining trigger

## Data Flow

1. Work item transitions to `factory:done` → lifecycle aggregated into `archived_lifecycles` table (decision summaries, learning entries, quality scores, run IDs, costs)
2. `minePatterns()` groups decisions by (kind, role), computes consistency scores, upserts into `decision_patterns`
3. `computeTrend()` reads recent quality scores and emits improving | stable | declining signal
4. `retrospective-deep` skill consumes `computeTrend` for the trend field (currently self-reported)

## Testing

Run `pnpm test slices/learning/slice.test.ts` to verify:
- Archive write on lifecycle completion
- Pattern grouping and consistency-score math
- Trend detection (rising / falling / flat windows)
- Empty archive edge case

## Context

See `docs/steves-training-materials/Markdown Files/Autonomous Development/08-learning-convergence-loop.md` and `docs/steves-training-materials/goose-hub-mapping.md`.
