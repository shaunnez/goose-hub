# core/learning

Cross-run learning loop for Goose Hub (M11.11).

Three modules:

- **archive.ts** — `archiveLifecycle({ projectId, workItemId })`: aggregates events into `archived_lifecycles` on state transition to `factory:done`.
- **mine.ts** — `minePatterns({ projectId, since? })`: groups decision summaries across archived lifecycles by `(kind, role)`, computes a `consistencyScore`, upserts `decision_patterns` rows.
- **convergence.ts** — `computeTrend({ projectId, role, skill?, windowSize? })`: reads recent `qualityScores` from the archive and returns `improving | stable | declining` (delta thresholds: improving > +0.05, declining < -0.05).

## HTTP trigger

`POST /projects/:slug/learning/mine` runs the miner on demand (optional `?since=ISO8601` param).

## DB tables

- `archived_lifecycles` — one row per closed work item lifecycle
- `decision_patterns` — upserted by the miner; uniquely keyed on `(projectId, kind, role)`
