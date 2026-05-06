# components/board

Kanban board for the active project (or all projects). Closes M2.06 (#31), M2.07 (#32), M10.03 (#284), and M11.05 (#297).

- `Board.tsx` — per-project Kanban: fetches issues for `projectSlug`, fetches the active milestone, groups into lanes.
- `AllProjectsBoard.tsx` — all-projects Kanban: fetches from every registered project in parallel, aggregates into shared lanes with per-card project color stripe. Route: `/projects/all`.
- `BoardColumn.tsx` — lane header (label + count + hide toggle), scrollable card list, "empty" placeholder.
- `IssueCard.tsx` — title, issue number, state pill, type pill, priority pill, age. Priority dot color-coded. Accepts optional `projectColor` to show a colored left border in all-projects mode. Cards with `schedule:blocked-by` show a danger-toned **Blocked** pill with a tooltip listing the blocking dep refs.
- `lib/all-projects.ts` — `WorkItemWithProject` type and `groupAllProjectsItems()` helper.
- `lib/lanes.config.ts` — 11 lanes / 9 default-visible per `docs/PLAN.md` §10.
- `state/lane-visibility.tsx` — lane visibility persistence.

## Blocked card indicator (M11.05)

When `WorkItemDto.schedule === 'blocked-by'`, `IssueCard` renders a danger-toned **Blocked** pill (`data-testid="blocked-indicator"`) in the bottom pill row. The pill's native `title` attribute lists the blocking dep refs (e.g. `"Blocked by: #199, other/repo#5"`). Same-repo refs are shortened to `#N`; cross-repo refs are shown in full.

The blocked border (`border-[color:var(--danger)]/40`) and the pill co-exist with the state/type/priority pills, milestone badge, persona chip, and cost badge.

When a dep closes and the scheduler removes `schedule:blocked-by` from GitHub, the card returns to its normal appearance on the next board fetch (navigating away and back, or on window re-focus after the stale-time window).

## All Projects board

`AllProjectsBoard` fetches `GET /projects/configs` to discover all registered projects and their `colorStripe`, then fires parallel `GET /projects/:slug/issues` for each. Items from all projects are merged and grouped by lane. Each card's left border is colored with its source project's `colorStripe`.

Real-time updates: the SSE connection omits the `projectId` filter (`/events` with no query param), so it receives transitions across all projects.

The project switcher includes "All Projects" as the first option, navigating to `/projects/all`.

## Lane visibility persistence

Per acceptance criterion "your call; document the decision": **`localStorage`** on the client (`goose-hub:lane-visibility`). It's per-browser cross-session, requires no schema changes, and matches the local-first / one-user model.
