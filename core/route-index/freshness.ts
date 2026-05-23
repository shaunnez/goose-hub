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
    const indexedPaths = new Set(rows.map((row) => row.path));
    const currentFiles = currentTsxFiles(input.repoRoot);
    const staleFiles = [
      ...rows.flatMap((row) => {
        const abs = path.join(input.repoRoot, row.path);
        return !fs.existsSync(abs) || Math.floor(fs.statSync(abs).mtimeMs) !== row.mtime_ms
          ? [row.path]
          : [];
      }),
      ...currentFiles.filter((file) => !indexedPaths.has(file)),
    ];
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
      if (freshness.corrupt && input.dbPath != null) removeRouteIndexDbFiles(input.dbPath);
      input.rebuild(input.repoRoot, input.dbPath);
      return assessRouteIndexFreshness(input);
    } catch {
      return freshness;
    }
  }
  return freshness;
}

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'coverage', '.git', '.factory']);

function currentTsxFiles(repoRoot: string): string[] {
  const root = path.join(repoRoot, 'apps/web/src');
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      if (entry.isFile() && entry.name.endsWith('.tsx')) {
        out.push(path.relative(repoRoot, abs).split(path.sep).join('/'));
      }
    }
  };
  visit(root);
  return out.sort();
}

function removeRouteIndexDbFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(file, { force: true });
  }
}
