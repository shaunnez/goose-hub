# roster

Roster page — cross-project persona leaderboard with per-role grouping, project filter, and history drill-in. Closes #282.

## Route

`/projects/:slug/roster`

## Components

- `RosterPage` — main page; fetches all personas, groups by role, renders `PersonaCard` grid
- `PersonaDrillIn` — right-side panel with quality stats, run history, and improvement candidates

## Project filter

A filter bar at the top of the page allows scoping to "All Projects" (default) or a single registered project. Project slugs are extracted from the `personaName` field (format: `<slug>/<role>/<index>`). In "All Projects" mode with more than one registered project, each persona card shows a colored attribution tag (dot + project name) sourced from `ProjectConfig.colorStripe`.

## Data

- `GET /roster` — all personas with aggregate stats (from `persona_stats` table)
- `GET /projects/configs` — project list and colorStripe map (for filter bar and attribution badges)
- `GET /roster/runs?persona=<name>` — per-run history (empty until per-run table is added)
- `GET /roster/candidates?persona=<name>` — pending improvement candidates (from `improvement_candidates` table)
- `POST /roster/candidates/:id/approve` — approve a candidate (status → approved) and create a GitHub issue in the active milestone
- `POST /roster/candidates/:id/reject` — reject a candidate (status → rejected)

## Improvement candidates

Candidates are created by the retrospective workflow (`core/workflows/retrospective.ts`) after each
retro run. Only `pending` candidates are shown in the drill-in. Approve/reject buttons are visible
on each pending candidate; clicking approve creates a `type:improvement` GitHub issue assigned to
the project active milestone when one is resolved, then removes the row from the list via query
invalidation.

## Empty states

- No personas: "No personas yet — stats accumulate as agent runs complete"
- No run history: "No run history recorded yet"
- No candidates: "No improvement candidates yet"

## Playbooks tab (M11.12)

A second tab on the roster page lists cross-run retrospective `PlaybookManifest` artifacts produced by `core/workflows/cross-run-retro.ts`. Each card shows the window dates, lifecycle count, and pattern/candidate counts; selecting a card opens a drill-in panel with the full manifest (summary, top patterns, improvement candidates, gate thresholds, cost baselines).

- `GET /projects/:slug/playbooks` — playbook summaries for the current project
- `GET /projects/:slug/playbooks/:id` — full manifest detail
- `POST /projects/:slug/playbooks` — manual trigger; body is one of `{ windowSize: N }` or `{ dateRange: { startAt, endAt } }`

The tab includes a manual generator with three presets:

- Last 7 days — sends `dateRange`
- Last 14 days — sends `dateRange`
- Last 10 lifecycles — sends `windowSize: 10`

On success, the playbook list is invalidated and the newly created playbook is selected.
