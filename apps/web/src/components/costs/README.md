# costs

Cost analytics slice. Provides a page and supporting components for viewing per-stage agent run costs for a target project, including token usage, cache-hit ratios, and estimated vs exact cost breakdowns.

## Components

- `CostsPage` — full-page view that fetches cost summary data via `GET /costs/:slug` and renders stat tiles (total cost, total tokens, total runs, cache-hit %) plus a per-stage breakdown using `StageBar`. Uses `useParams` to read the project slug and `useQuery` to fetch data.
- `StageBar` — single-row bar chart entry for one workflow stage. Accepts `stage`, `totalUsd`, `hasEstimated`, `totalRuns`, `maxUsd`, `cacheHitRatio`, `cacheCreationInputTokens`, and `reasoningOutputTokens` as props. Renders a proportional bar relative to `maxUsd`.
- `CostLegend` — inline legend explaining the `~$` estimated-cost prefix. Renders unconditionally; callers decide when to show it.

## Tests

See `slice.test.ts` for smoke tests covering all three components.
