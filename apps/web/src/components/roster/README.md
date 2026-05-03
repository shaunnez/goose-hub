# roster

Roster page — per-role persona list with metrics and history drill-in.

## Route

`/projects/:slug/roster`

## Components

- `RosterPage` — main page; fetches all personas, groups by role, renders `PersonaCard` grid
- `PersonaDrillIn` — right-side panel with quality stats, run history, and improvement candidates

## Data

- `GET /roster` — all personas with aggregate stats (from `persona_stats` table)
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
