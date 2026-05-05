# components/board

Kanban board for the active project (or all projects). Closes M2.06 (#31), M2.07 (#32), and M10.03 (#284).

- `Board.tsx` — per-project Kanban: fetches issues for `projectSlug`, fetches the active milestone, groups into lanes.
- `AllProjectsBoard.tsx` — all-projects Kanban: fetches from every registered project in parallel, aggregates into shared lanes with per-card project color stripe. Route: `/projects/all`.
- `BoardColumn.tsx` — lane header (label + count + hide toggle), scrollable card list, "empty" placeholder.
- `IssueCard.tsx` — title, issue number, state pill, type pill, priority pill, age. Priority dot color-coded. Accepts optional `projectColor` to show a colored left border in all-projects mode.
- `lib/all-projects.ts` — `WorkItemWithProject` type and `groupAllProjectsItems()` helper.
- `lib/lanes.config.ts` — 11 lanes / 9 default-visible per `docs/PLAN.md` §10.
- `state/lane-visibility.tsx` — lane visibility persistence.

## All Projects board

`AllProjectsBoard` fetches `GET /projects/configs` to discover all registered projects and their `colorStripe`, then fires parallel `GET /projects/:slug/issues` for each. Items from all projects are merged and grouped by lane. Each card's left border is colored with its source project's `colorStripe`.

Real-time updates: the SSE connection omits the `projectId` filter (`/events` with no query param), so it receives transitions across all projects.

The project switcher includes "All Projects" as the first option, navigating to `/projects/all`.

## Lane visibility persistence

Per acceptance criterion "your call; document the decision": **`localStorage`** on the client (`goose-hub:lane-visibility`). It's per-browser cross-session, requires no schema changes, and matches the local-first / one-user model.
