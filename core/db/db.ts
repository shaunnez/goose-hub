import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const dbPath = path.join(os.homedir(), '.factory', 'data', 'factory.db');
const dbDir = path.dirname(dbPath);

mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });
