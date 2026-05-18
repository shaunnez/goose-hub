import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_INCLUDE_DIRS, buildIndex, walkTsFiles } from './builder.js';
import { defaultDbPath, openIndexDb } from './db.js';

export interface SymbolIndexFreshnessOptions {
  repoRoot: string;
  dbPath?: string;
  includeDirs?: string[];
}

export interface SymbolIndexFreshness {
  dbPath: string;
  dbAgeMs: number;
  stale: boolean;
  missing: boolean;
  corrupt: boolean;
  newestSourceMtimeMs: number | null;
  error?: string;
}

export interface EnsureSymbolIndexFreshResult extends SymbolIndexFreshness {
  rebuilt: boolean;
}

function newestIndexedSourceMtimeMs(repoRoot: string, includeDirs: string[]): number | null {
  let newest: number | null = null;
  for (const dir of includeDirs) {
    const absDir = path.join(repoRoot, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const file of walkTsFiles(absDir)) {
      let mtime: number;
      try {
        mtime = fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      newest = newest == null ? mtime : Math.max(newest, mtime);
    }
  }
  return newest;
}

function assertReadableIndex(dbPath: string): void {
  const db = openIndexDb(dbPath);
  try {
    db.prepare('SELECT COUNT(*) AS count FROM files').get();
  } finally {
    db.close();
  }
}

export function assessSymbolIndexFreshness(
  options: SymbolIndexFreshnessOptions,
): SymbolIndexFreshness {
  const dbPath = options.dbPath ?? defaultDbPath();
  const includeDirs = options.includeDirs ?? DEFAULT_INCLUDE_DIRS;
  const newestSourceMtimeMs = newestIndexedSourceMtimeMs(options.repoRoot, includeDirs);

  if (!fs.existsSync(dbPath)) {
    return {
      dbPath,
      dbAgeMs: -1,
      stale: true,
      missing: true,
      corrupt: false,
      newestSourceMtimeMs,
    };
  }

  try {
    assertReadableIndex(dbPath);
    const dbMtimeMs = fs.statSync(dbPath).mtimeMs;
    const stale = newestSourceMtimeMs != null && dbMtimeMs < newestSourceMtimeMs;
    return {
      dbPath,
      dbAgeMs: Math.max(0, Date.now() - dbMtimeMs),
      stale,
      missing: false,
      corrupt: false,
      newestSourceMtimeMs,
    };
  } catch (error) {
    return {
      dbPath,
      dbAgeMs: -1,
      stale: true,
      missing: false,
      corrupt: true,
      newestSourceMtimeMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function ensureSymbolIndexFresh(
  options: SymbolIndexFreshnessOptions,
): EnsureSymbolIndexFreshResult {
  const before = assessSymbolIndexFreshness(options);
  if (!before.missing && !before.stale && !before.corrupt) return { ...before, rebuilt: false };

  try {
    if (before.corrupt && fs.existsSync(before.dbPath)) {
      fs.rmSync(before.dbPath, { force: true });
      fs.rmSync(`${before.dbPath}-wal`, { force: true });
      fs.rmSync(`${before.dbPath}-shm`, { force: true });
    }
    buildIndex({
      repoRoot: options.repoRoot,
      dbPath: before.dbPath,
      includeDirs: options.includeDirs,
    });
    const after = assessSymbolIndexFreshness(options);
    return { ...after, rebuilt: true };
  } catch (error) {
    return {
      ...before,
      rebuilt: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
