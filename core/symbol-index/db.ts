import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  last_indexed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  exported INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  source_module TEXT NOT NULL,
  imported_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_imports_module ON imports(source_module);
CREATE INDEX IF NOT EXISTS idx_imports_name ON imports(imported_name);
CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_path);
`;

/**
 * Open (or create) the local symbol-index SQLite database.
 *
 * Default path is `~/.factory/symbol-index.db` to live alongside other
 * Goose Hub local operational state. Pass `':memory:'` for ephemeral test
 * databases.
 */
export function openIndexDb(dbPath?: string): Database.Database {
  const resolved = dbPath ?? defaultDbPath();
  if (resolved !== ':memory:') {
    mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function defaultDbPath(): string {
  return path.join(os.homedir(), '.factory', 'symbol-index.db');
}

export function symbolIndexDbPathForWorktree(worktreePath: string): string {
  return path.join(worktreePath, '.factory', 'symbol-index.db');
}
