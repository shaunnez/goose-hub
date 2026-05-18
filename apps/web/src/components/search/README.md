# search

Cross-project search. Full-bleed modal with backdrop blur, opened from the TopBar button or `⌘K`.

Tracking issue: [#834](https://github.com/shaunnez/goose-hub/issues/834).

## Components

- `SearchModal` — full-bleed overlay (`backdrop-blur-xl`) hosting the input, filter chips, results body, and footer key-hint row. Focuses the input on open; closes on Esc, backdrop click, or the close button. Resets query + filters on close. Owns `FilterState` and the recent-searches list.
- `SearchResults` — React Query consumer of `/api/search`. Renders idle (recents or hint) / loading (skeleton rows) / error (retry button) / empty / results states. `↑↓` moves the selected row, `↵` opens it, hover moves selection too. Each row shows a percent confidence pill and matching tokens in the title are wrapped in `<mark>`.

## Lib

- `useDebouncedValue<T>(value, delayMs)` — generic value debounce. SearchModal feeds it the raw input at 200ms so React Query keys settle before requests fire.
- `recentSearches.{loadRecentSearches, pushRecentSearch, clearRecentSearches}` — localStorage-backed list of the last 5 queries the user opens a result from. Tolerant of corrupt / disabled storage.
- `highlight(text, tokens)` — splits a string around case-insensitive token matches and wraps each in `<mark>`. `tokenize(query)` extracts the same token list used for matching.

## Filters

- **Scope** — toggle between the current project (when one is in the URL) and all projects.
- **Milestone** — toggle between the project's active milestone and all milestones.
- **Type** — cycle through `Any type` → feature → bug → chore → research.
- **Open only / Include closed** — toggles closed items into the result set. Only available while the **Milestone** filter is "Active milestone": the server includes closed items via `listClosedWorkByMilestone(activeMilestoneNumber)`. Disabled (with tooltip) while Milestone is "All milestones" because that would require iterating every milestone per project.

## Surfaces touched

- `apps/web/src/components/chrome/TopBar.tsx` — Search button + `⌘K` / `Ctrl+K` shortcut + modal mount.
- `apps/web/src/lib/api/search.ts` — `fetchSearch(q, { limit?, projectSlug?, type?, milestone?, signal? })` hits `GET /api/search`.
- `apps/web/src/lib/types.ts` — `SearchHitDto`, `SearchResultDto`.
- `apps/server/src/domains/search/` — server-side endpoint, scoring, ranking.

## Still out of scope

- Searchable surfaces beyond work items (inbox, milestones, projects, comments, events).
- `Include closed` while Milestone is `all` (needs per-project milestone iteration).
- `search.performed` telemetry event.
- SQLite FTS5 index — revisit if the in-memory ranker doesn't scale.
