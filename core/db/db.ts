import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const dbPath = process.env.DB_PATH ?? path.join(os.homedir(), '.factory', 'data', 'factory.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });

// Apply any pending migrations on startup. Safe to call repeatedly —
// drizzle tracks applied migrations in __drizzle_migrations.
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
migrate(db, { migrationsFolder });
