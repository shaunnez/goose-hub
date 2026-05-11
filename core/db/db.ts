import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

/**
 * Resolve the database path. Under Vitest each worker gets its own file so
 * concurrent migrations (one per worker process) don't race on the same
 * SQLite file. Outside tests, all callers share `~/.factory/data/factory.db`
 * unless `DB_PATH` overrides it.
 */
function resolveDbPath(): string {
  if (process.env.DB_PATH != null) return process.env.DB_PATH;
  const workerId =
    process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? (process.env.VITEST ? '0' : null);
  if (workerId != null) {
    return path.join(os.tmpdir(), `factory-vitest-${process.pid}-${workerId}.db`);
  }
  return path.join(os.homedir(), '.factory', 'data', 'factory.db');
}

const dbPath = resolveDbPath();
mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
// SQLite must allow concurrent reads/writes to survive vitest's per-file
// migration on startup. WAL mode + a generous busy timeout transforms the
// race into a wait. Outside tests this is a no-op for the single connection.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
export const db = drizzle(sqlite, { schema });

// Apply any pending migrations on startup. Safe to call repeatedly —
// drizzle tracks applied migrations in __drizzle_migrations.
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
migrate(db, { migrationsFolder });
