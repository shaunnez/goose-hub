# core/db

Local SQLite store (Drizzle ORM). Holds **operational state only** — events, persona stats, governance audit trail, per-project settings. Work-item authority lives in the source of truth (GitHub Issues), never here.

## Database location

`~/.factory/data/factory.db` — created on first import; the directory is auto-created.

## Modules

### `schema.ts`

Drizzle table definitions. Three tables ship in M1; more land in later milestones.

- **`project_state`** — per-project settings: `projectId` (PK), `activeMilestoneNumber`, `activeMilestoneSetAt`, `activeMilestoneSetBy`, `lastTickAt`.
- **`events`** — append-only event log: `id`, `projectId`, `workItemId?`, `kind`, `payload` (JSON), `createdAt`. Indexed by `(projectId, createdAt)` for SSE replay.
- **`governance_audit`** — PR governance check results: `id`, `prUrl`, `projectId`, `ok`, `violations` (JSON), `checkedAt`.

### `db.ts`

Exports the singleton `db` Drizzle handle bound to `better-sqlite3`. Importing it ensures `~/.factory/data/` exists and applies any pending migrations from `core/db/migrations/` (tracked in `__drizzle_migrations`).

### `migrate.ts`

Programmatic entry point that touches the DB so the file is created. Migrations auto-apply on import via `db.ts`. To author a new migration after a schema change: `pnpm db:generate`. To apply manually: `pnpm db:migrate`.

### `migrations/`

Generated SQL migration files (committed to git). Drizzle compares the schema snapshot in `meta/` against `schema.ts` to produce additive `ALTER TABLE` statements rather than `drizzle-kit push`'s drop-and-recreate behaviour.

## Consumers

No live consumers in M1 (the CLI is read-only against GitHub). First consumers arrive in M2 with the server's event stream and active-milestone persistence.

## Rules

- Never store work-item state here that could be read from the source of truth — it goes stale.
- All event writes go through a single `appendEvent()` chokepoint (introduced in M2 per `CONTEXT.md`); never write to `events` directly.
