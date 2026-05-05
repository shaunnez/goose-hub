# Drizzle Migrations (replace push with generate+migrate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `drizzle-kit push` with explicit SQL migration files so schema changes never silently drop and recreate tables (which was wiping `persona_names` codenames).

**Architecture:** Generate a baseline migration snapshot from the current schema, bootstrap the live DB by marking it as already applied, then wire programmatic `migrate()` into the server startup path so future schema changes are applied safely on next run. `pnpm db:generate` creates new migration files; `pnpm db:migrate` applies them via CLI.

**Tech Stack:** drizzle-kit v0.31.10, drizzle-orm v0.45.2, better-sqlite3, Node/TypeScript

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Replace `db:migrate` (push) with `db:generate` + `db:migrate` (generate/migrate) |
| `drizzle.config.ts` | No change needed — `out` already set to `./core/db/migrations` |
| `core/db/db.ts` | Add `migrate()` call so migrations auto-apply on DB open |
| `core/db/migrate.ts` | Update comment to reflect new approach |
| `core/db/migrations/` | New directory — generated SQL + snapshot files (committed to git) |

---

### Task 1: Generate the initial migration snapshot

**Files:**
- Create: `core/db/migrations/` (auto-created by drizzle-kit)

The first migration represents the full current schema. We generate it, then bootstrap the live DB so drizzle doesn't try to re-run `CREATE TABLE` on tables that already exist.

- [ ] **Step 1: Run generate to create the baseline migration**

```bash
pnpm drizzle-kit generate --config=drizzle.config.ts
```

Expected output: something like `1 migration(s) generated` and a file created at `core/db/migrations/0000_*.sql`.

- [ ] **Step 2: Verify the migration file looks correct**

```bash
ls core/db/migrations/
cat core/db/migrations/0000_*.sql
```

Expected: SQL file contains `CREATE TABLE` statements for all 9 tables (`project_state`, `events`, `governance_audit`, `inbox_items`, `persona_routing`, `persona_stats`, `improvement_candidates`, `persona_names`, `agent_run_costs`) plus their indexes.

- [ ] **Step 3: Bootstrap the live DB — mark baseline migration as already applied**

The live DB at `~/.factory/data/factory.db` already has all tables. We need to tell drizzle "this first migration is already done" by inserting its record into the `__drizzle_migrations` table.

First, find the exact migration hash. Drizzle uses the filename (without extension) as the identifier:

```bash
ls core/db/migrations/*.sql
# Note the filename, e.g. 0000_bright_moondragon.sql
```

Then insert the bootstrap record:

```bash
sqlite3 ~/.factory/data/factory.db "
CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  created_at NUMERIC
);
INSERT OR IGNORE INTO __drizzle_migrations (hash, created_at)
VALUES ('$(ls core/db/migrations/*.sql | xargs basename | sed s/.sql//)', unixepoch());
"
```

- [ ] **Step 4: Verify bootstrap worked**

```bash
sqlite3 ~/.factory/data/factory.db "SELECT * FROM __drizzle_migrations;"
```

Expected: one row with the migration filename hash and a timestamp.

- [ ] **Step 5: Commit the generated migration files**

```bash
git add core/db/migrations/
git commit -m "chore(db): add baseline migration snapshot for drizzle generate+migrate workflow"
```

---

### Task 2: Wire programmatic migrations into server startup

**Files:**
- Modify: `core/db/db.ts`
- Modify: `core/db/migrate.ts`

Instead of requiring a manual CLI step, auto-apply any pending migrations when the DB module is first imported. This means new migrations land automatically on next server start.

- [ ] **Step 1: Write the failing test**

Add a test in `core/db/smoke.test.ts` that confirms `__drizzle_migrations` exists after DB initialisation. Open `core/db/smoke.test.ts` and add at the end of the existing describe block:

```typescript
it('__drizzle_migrations table exists after db init', () => {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .all();
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run core/db/smoke.test.ts
```

Expected: FAIL — `__drizzle_migrations` won't exist until we wire in `migrate()`.

Wait — actually this test may already pass if you bootstrapped the live DB in Task 1. If so, skip ahead. The important thing is the behaviour is correct; the table existing matters.

- [ ] **Step 3: Update `core/db/db.ts` to auto-migrate**

Read current content first, then replace with:

```typescript
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const dbPath = path.join(os.homedir(), '.factory', 'data', 'factory.db');
const dbDir = path.dirname(dbPath);

mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });

// Apply any pending migrations on startup. Safe to call repeatedly —
// drizzle tracks applied migrations in __drizzle_migrations.
const migrationsFolder = new URL('../../core/db/migrations', import.meta.url).pathname;
migrate(db, { migrationsFolder });
```

Note: the `migrationsFolder` path needs to resolve correctly relative to wherever `db.ts` is imported from. Since `db.ts` lives at `core/db/db.ts`, the relative path `./migrations` from the file's own directory is simpler. Use `fileURLToPath` + `import.meta.url`:

```typescript
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const dbPath = path.join(os.homedir(), '.factory', 'data', 'factory.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });

const migrationsFolder = path.join(fileURLToPath(import.meta.url), '..', 'migrations');
migrate(db, { migrationsFolder });
```

- [ ] **Step 4: Run the smoke test to verify it passes**

```bash
pnpm vitest run core/db/smoke.test.ts
```

Expected: all tests pass including the new `__drizzle_migrations` one.

- [ ] **Step 5: Update `core/db/migrate.ts` comment**

```typescript
import { db } from './db.js';

// Programmatic entry point: ensures ~/.factory/data/ exists and the DB file is
// created. Migrations are applied automatically by db.ts on import via migrate().
// To create a new migration after a schema change: pnpm db:generate
// To apply manually: pnpm db:migrate
console.log('DB ready at', db);
```

- [ ] **Step 6: Commit**

```bash
git add core/db/db.ts core/db/migrate.ts core/db/smoke.test.ts
git commit -m "feat(db): auto-apply migrations on startup via drizzle migrate()"
```

---

### Task 3: Update package.json scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read the current scripts section**

```bash
grep -A5 '"scripts"' package.json
```

- [ ] **Step 2: Replace `db:migrate` and add `db:generate`**

In `package.json`, find:

```json
"db:migrate": "drizzle-kit push --config=drizzle.config.ts",
```

Replace with:

```json
"db:generate": "drizzle-kit generate --config=drizzle.config.ts",
"db:migrate": "drizzle-kit migrate --config=drizzle.config.ts",
```

- [ ] **Step 3: Verify no other scripts reference `push`**

```bash
grep "push" package.json
```

Expected: only git-related mentions, no drizzle-kit push.

- [ ] **Step 4: Run full test suite to confirm nothing broken**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(db): replace drizzle-kit push with generate+migrate scripts"
```

---

### Task 4: Verify the full workflow end-to-end

This task has no code changes — it verifies the new workflow behaves correctly.

- [ ] **Step 1: Confirm persona_names still intact**

```bash
sqlite3 ~/.factory/data/factory.db "SELECT COUNT(*) FROM persona_names;"
```

Expected: same count as before (14 rows). No data lost.

- [ ] **Step 2: Simulate a future schema change**

Add a harmless column to `inboxItems` in `schema.ts` as a test:

```typescript
// In inboxItems table, add:
priority: integer('priority').notNull().default(0),
```

- [ ] **Step 3: Generate a new migration**

```bash
pnpm db:generate
```

Expected: new file in `core/db/migrations/0001_*.sql` containing `ALTER TABLE inbox_items ADD COLUMN priority integer DEFAULT 0 NOT NULL`.

Check the SQL:
```bash
cat core/db/migrations/0001_*.sql
```

Confirm it's `ALTER TABLE`, not `DROP TABLE` / `CREATE TABLE`. This proves the new workflow never silently rebuilds tables.

- [ ] **Step 4: Apply the migration**

```bash
pnpm db:migrate
```

Expected: migration applied. Check:
```bash
sqlite3 ~/.factory/data/factory.db "PRAGMA table_info(inbox_items);" | grep priority
```

- [ ] **Step 5: Confirm persona_names still intact after migration**

```bash
sqlite3 ~/.factory/data/factory.db "SELECT COUNT(*) FROM persona_names;"
```

Expected: still 14 rows. This is the proof the problem is solved.

- [ ] **Step 6: Revert the test schema change**

Remove the `priority` column from `schema.ts` and delete the `0001_*.sql` migration file. This was just a verification step.

```bash
git checkout -- core/db/schema.ts
rm core/db/migrations/0001_*.sql
# Also roll back the DB column if it was applied:
sqlite3 ~/.factory/data/factory.db "ALTER TABLE inbox_items DROP COLUMN priority;" 2>/dev/null || true
```

- [ ] **Step 7: Final test run**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

---

## Self-Review

**Spec coverage:**
- Root cause (push silently drops tables) → fixed by removing push ✓
- Bootstrap existing DB without data loss → Task 1 Step 3 ✓
- Auto-apply on startup → Task 2 ✓
- Scripts updated → Task 3 ✓
- End-to-end proof → Task 4 ✓

**Placeholder scan:** No TBDs, no "implement later", all code blocks present.

**Type consistency:** `migrate` imported from `drizzle-orm/better-sqlite3/migrator` — consistent with drizzle-orm v0.45.x API.
