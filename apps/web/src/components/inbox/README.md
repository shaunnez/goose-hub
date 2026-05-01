# inbox

Inbox capture slice. Provides a modal for quickly capturing ideas, tasks, or bugs into the local inbox before they are promoted to a target project.

## Components

- `CaptureModal` — overlay form that collects title (required), type (feature/bug/chore/research), and optional notes. On submit, calls `POST /inbox` via `createInboxItem` in `lib/api.ts` and inserts a row into the `inbox_items` SQLite table. Modal closes on success and resets form state.

## Surfaces touched

- `apps/server/src/index.ts` — `POST /inbox` route
- `core/db/schema.ts` — `inboxItems` table
- `apps/web/src/lib/api.ts` — `createInboxItem`
- `apps/web/src/components/chrome/TopBar.tsx` — Capture button trigger
