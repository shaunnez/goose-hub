import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  mtime_ms INTEGER NOT NULL,
  last_indexed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path_pattern TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  component TEXT
);
CREATE TABLE IF NOT EXISTS component_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routes_path ON routes(path_pattern);
CREATE INDEX IF NOT EXISTS idx_routes_component ON routes(component);
CREATE INDEX IF NOT EXISTS idx_component_usages_component ON component_usages(component);
CREATE INDEX IF NOT EXISTS idx_component_usages_file ON component_usages(file_path);
`;

export function openRouteIndexDb(dbPath?: string): Database.Database {
  const resolved = dbPath ?? defaultRouteIndexDbPath();
  if (resolved !== ':memory:') mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function defaultRouteIndexDbPath(): string {
  return path.join(os.homedir(), '.factory', 'route-index.db');
}

export function routeIndexDbPathForWorktree(worktreePath: string): string {
  return path.join(worktreePath, '.factory', 'route-index.db');
}
