# search

Cross-project search. Full-bleed modal with backdrop blur, opened from the TopBar button or `⌘K`.

Tracking issue: [#834](https://github.com/shaunnez/goose-hub/issues/834).

## Components

- `SearchModal` — full-bleed overlay (`backdrop-blur-xl`) hosting the search input, filter chips, results body, and footer key-hint row. Focuses the input on open. Closes on Esc, backdrop click, or the close button.

## Surfaces touched

- `apps/web/src/components/chrome/TopBar.tsx` — enables the Search button, binds the `⌘K` / `Ctrl+K` hotkey, mounts `SearchModal`.

## v0 scope (PR-1)

Skeleton only. The filter chips are rendered but disabled. The body shows a placeholder hint. Real search results, scoring, and filter behaviour land in subsequent PRs:

- PR-2 — `/api/search` endpoint + scoring (`apps/server/src/domains/search/`).
- PR-3 — wire React Query results into the modal body, render confidence pills.
- PR-4 — make the filter chips live.
- PR-5 — `Show more` pagination + recent searches.
- PR-6 — highlighted snippets, telemetry, focus trap.
