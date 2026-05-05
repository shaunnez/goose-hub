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
- `POST /roster/candidates/:id/approve` — approve a candidate (status → approved)
- `POST /roster/candidates/:id/reject` — reject a candidate (status → rejected)

## Improvement candidates

Candidates are created by the retrospective workflow (`core/workflows/retrospective.ts`) after each
retro run. Only `pending` candidates are shown in the drill-in. Approve/reject buttons are visible
on each pending candidate; clicking one calls the API and removes the row from the list via query
invalidation.

## Empty states

- No personas: "No personas yet — stats accumulate as agent runs complete"
- No run history: "No run history recorded yet"
- No candidates: "No improvement candidates yet"
