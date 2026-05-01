# components/board

Kanban board for the active project. Closes M2.06 (#31) and embeds the issue card from M2.07 (#32).

- `Board.tsx` — fetches issues for `projectSlug`, fetches the active milestone (`/projects/:slug/active-milestone`, falling back to GitHub default), filters items by `milestoneId`, groups them into lanes via `lib/lanes.config.ts`, and renders one `BoardColumn` per visible lane.
- `BoardColumn.tsx` — lane header (label + count + hide toggle), scrollable card list, "empty" placeholder.
- `IssueCard.tsx` — title, issue number, state pill, type pill, priority pill, age. Priority dot color-coded.
- `lib/lanes.config.ts` — 11 lanes / 9 default-visible per `docs/PLAN.md` §10.
- `state/lane-visibility.tsx` — lane visibility persistence.

## Lane visibility persistence

Per acceptance criterion "your call; document the decision": **`localStorage`** on the client (`goose-hub:lane-visibility`). It's per-browser cross-session, requires no schema changes, and matches the local-first / one-user model. The plan originally hinted at `project_state` but localStorage is simpler for M2 and keeps the kanban purely client-driven; we can promote to `project_state` later if multi-device sync becomes a need.
