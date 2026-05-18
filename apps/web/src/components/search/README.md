# search

Cross-project search. Full-bleed modal with backdrop blur, opened from the TopBar button or `⌘K`.

Tracking issue: [#834](https://github.com/shaunnez/goose-hub/issues/834).

## Components

- `SearchModal` — full-bleed overlay (`backdrop-blur-xl`) hosting the search input, filter chips, results body, and footer key-hint row. Focuses the input on open. Closes on Esc, backdrop click, or the close button. Resets its query each time it re-opens.
- `SearchResults` — React Query consumer of `/api/search`. Renders idle / loading (skeleton rows) / error (retry button) / empty / results states. Each result row carries a percent confidence pill normalised so the top hit reads `100`.

## Lib

- `useDebouncedValue<T>(value, delayMs)` — generic value debounce; the modal feeds it the raw input with `delayMs = 200` so React Query keys settle before firing.

## Surfaces touched

- `apps/web/src/components/chrome/TopBar.tsx` — enables the Search button, binds the `⌘K` / `Ctrl+K` hotkey, mounts `SearchModal`.
- `apps/web/src/lib/api/search.ts` — `fetchSearch(q, { limit?, signal? })` hits `GET /api/search`.
- `apps/web/src/lib/types.ts` — `SearchHitDto`, `SearchResultDto`.
- `apps/server/src/domains/search/` — server-side endpoint, scoring, ranking.

## Out of scope (still PRs to come under #834)

- Live filter chips (scope / milestone / type / includeClosed) — PR-4.
- `Show more` pagination + recent searches — PR-5.
- Highlighted match snippets, focus trap, `search.performed` telemetry — PR-6.
