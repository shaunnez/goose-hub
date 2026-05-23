import fs from 'node:fs';
import path from 'node:path';
import { openRouteIndexDb } from './db.js';

export interface RouteIndexFreshness {
  missing: boolean;
  corrupt: boolean;
  stale: boolean;
  staleFiles: string[];
}

export function assessRouteIndexFreshness(input: {
  repoRoot: string;
  dbPath?: string;
}): RouteIndexFreshness {
  if (input.dbPath != null && !fs.existsSync(input.dbPath)) {
    return { missing: true, corrupt: false, stale: false, staleFiles: [] };
  }
  let db: ReturnType<typeof openRouteIndexDb>;
  try {
    db = openRouteIndexDb(input.dbPath);
  } catch {
    return { missing: false, corrupt: true, stale: false, staleFiles: [] };
  }
  try {
    const rows = db.prepare('SELECT path, mtime_ms FROM files').all() as Array<{
      path: string;
      mtime_ms: number;
    }>;
    const staleFiles = rows
      .filter((row) => {
        const abs = path.join(input.repoRoot, row.path);
        return !fs.existsSync(abs) || Math.floor(fs.statSync(abs).mtimeMs) !== row.mtime_ms;
      })
      .map((row) => row.path);
    return { missing: rows.length === 0, corrupt: false, stale: staleFiles.length > 0, staleFiles };
  } catch {
    return { missing: false, corrupt: true, stale: false, staleFiles: [] };
  } finally {
    db.close();
  }
}

export function ensureRouteIndexFresh(input: {
  repoRoot: string;
  dbPath?: string;
  rebuild: (repoRoot: string, dbPath: string | undefined) => unknown;
}): RouteIndexFreshness {
  const freshness = assessRouteIndexFreshness(input);
  if (freshness.missing || freshness.stale || freshness.corrupt) {
    try {
      input.rebuild(input.repoRoot, input.dbPath);
      return assessRouteIndexFreshness(input);
    } catch {
      return freshness;
    }
  }
  return freshness;
}
