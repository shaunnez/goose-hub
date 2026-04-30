# apps/web/e2e

Playwright happy-path test for M2. Closes M2.11 (#36).

## Run

```sh
GITHUB_TOKEN=ghp_… pnpm --filter @goose-hub/web test:e2e
```

The test skips gracefully when `GITHUB_TOKEN` is empty, per #36's acceptance criterion.

`exec:serial` — must not run in parallel with other Playwright tests.

## What's covered

- Open Goose Hub at `/` → redirects to `/projects/goose-hub-self`.
- Project switcher reflects the active slug.
- Kanban renders ≥ 1 real issue from `shaunnez/goose-hub`.
- Click a card → routed full-takeover detail page with the 10-section left rail.
- Overview body renders.
- Right rail shows the "No agent runs" empty state.
- Timeline section navigable.
- Transition popover lists legal next states for issues with non-terminal state.
- Direct URL roundtrip (`/projects/:slug/items/:id`) works.
- Back-to-board button returns to the kanban.

The full state-transition round-trip (POST → GitHub label updated → SSE event arrives → Board card moves lane) is covered manually because the GitHub label flip side-effects a real issue. CI runs the popover-only path for safety.
