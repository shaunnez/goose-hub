import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildIndex } from './builder.js';
import { openIndexDb } from './db.js';
import { assessSymbolIndexFreshness, ensureSymbolIndexFresh } from './freshness.js';
import {
  findCallers,
  findCallersOfExport,
  findSymbol,
  listExportsOf,
  listImports,
} from './query.js';

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

describe('core/symbol-index', () => {
  let tmp: string;
  let db: Database.Database;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-index-'));
    db = openIndexDb(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('indexes exported function/class/const/interface/type/enum declarations', () => {
    writeFile(
      tmp,
      'core/foo/bar.ts',
      `export function greet(name: string) { return name; }
export class Greeter { greet(name: string) { return name; } }
export const TAU = 6.28;
export interface IFoo { x: number; }
export type Foo = { x: number };
export enum Color { Red, Blue }
const PRIVATE = 1;`,
    );

    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });

    expect(findSymbol(db, 'greet').map((s) => s.kind)).toContain('function');
    expect(findSymbol(db, 'Greeter').map((s) => s.kind)).toContain('class');
    expect(findSymbol(db, 'TAU').map((s) => s.kind)).toContain('const');
    expect(findSymbol(db, 'IFoo').map((s) => s.kind)).toContain('interface');
    expect(findSymbol(db, 'Foo').map((s) => s.kind)).toContain('type');
    expect(findSymbol(db, 'Color').map((s) => s.kind)).toContain('enum');
    expect(findSymbol(db, 'PRIVATE')).toHaveLength(1);
    expect(findSymbol(db, 'PRIVATE')[0].exported).toBe(false);
  });

  it('records line numbers (1-indexed) per symbol', () => {
    writeFile(
      tmp,
      'core/lines/a.ts',
      `// header comment
export function first() {}
export function second() {}`,
    );
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });

    const first = findSymbol(db, 'first');
    const second = findSymbol(db, 'second');
    expect(first[0].line).toBe(2);
    expect(second[0].line).toBe(3);
  });

  it('records imports and resolves callers via findCallers', () => {
    writeFile(tmp, 'core/lib/api.ts', 'export function fetchUser() {}');
    writeFile(
      tmp,
      'apps/web/src/page.ts',
      `import { fetchUser } from '../../../core/lib/api.js';
fetchUser();`,
    );

    buildIndex({ repoRoot: tmp, db, includeDirs: ['apps', 'core'] });

    const callers = findCallers(db, 'fetchUser');
    expect(callers).toContain('apps/web/src/page.ts');
  });

  it('resolves callers for a specific exported module', () => {
    writeFile(tmp, 'core/a/config.ts', 'export function Config() {}');
    writeFile(tmp, 'core/b/config.ts', 'export function Config() {}');
    writeFile(
      tmp,
      'apps/server/src/from-a.ts',
      `import { Config } from '@goose-hub/core/a/config.js';`,
    );
    writeFile(
      tmp,
      'apps/server/src/from-b.ts',
      `import { Config } from '@goose-hub/core/b/config.js';`,
    );

    buildIndex({ repoRoot: tmp, db, includeDirs: ['apps', 'core'] });

    expect(findCallersOfExport(db, 'core/a/config.ts', 'Config')).toEqual([
      'apps/server/src/from-a.ts',
    ]);
    expect(findCallersOfExport(db, 'core/b/config.ts', 'Config')).toEqual([
      'apps/server/src/from-b.ts',
    ]);
  });

  it('captures default and namespace imports', () => {
    writeFile(
      tmp,
      'apps/server/index.ts',
      `import Database from 'better-sqlite3';
import * as ts from 'typescript';`,
    );
    buildIndex({ repoRoot: tmp, db, includeDirs: ['apps'] });

    const imports = listImports(db, 'apps/server/index.ts');
    expect(imports.map((i) => i.importedName).sort()).toEqual(['Database', 'ts']);
  });

  it('listExportsOf returns only exported symbols for a file', () => {
    writeFile(
      tmp,
      'core/lib/mixed.ts',
      `export function pub() {}
function priv() {}
export const X = 1;`,
    );
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });

    const exported = listExportsOf(db, 'core/lib/mixed.ts')
      .map((s) => s.name)
      .sort();
    expect(exported).toEqual(['X', 'pub']);
  });

  it('skips node_modules, dist, .factory, .worktrees, coverage', () => {
    writeFile(tmp, 'core/keep.ts', 'export const KEEP = 1;');
    writeFile(tmp, 'core/node_modules/skip-me.ts', 'export const SKIP = 1;');
    writeFile(tmp, 'core/dist/skip-me.ts', 'export const SKIP = 1;');
    writeFile(tmp, 'core/.factory/skip-me.ts', 'export const SKIP = 1;');

    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });

    expect(findSymbol(db, 'KEEP')).toHaveLength(1);
    expect(findSymbol(db, 'SKIP')).toHaveLength(0);
  });

  it('is idempotent — re-running the build does not duplicate rows', () => {
    writeFile(tmp, 'core/dup/a.ts', 'export const A = 1;');

    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    const first = findSymbol(db, 'A');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    const second = findSymbol(db, 'A');

    expect(second).toHaveLength(first.length);
    expect(second).toHaveLength(1);
  });

  it('drops rows for files that no longer exist on re-build', () => {
    writeFile(tmp, 'core/will-delete/a.ts', 'export const GONE = 1;');
    writeFile(tmp, 'core/will-stay/b.ts', 'export const STAYS = 1;');

    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    expect(findSymbol(db, 'GONE')).toHaveLength(1);

    fs.rmSync(path.join(tmp, 'core', 'will-delete'), { recursive: true, force: true });
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });

    expect(findSymbol(db, 'GONE')).toHaveLength(0);
    expect(findSymbol(db, 'STAYS')).toHaveLength(1);
  });

  it('reports counts via BuildResult', () => {
    writeFile(tmp, 'core/counts/a.ts', `export const A = 1;\nimport { b } from './b.js';`);
    writeFile(tmp, 'core/counts/b.ts', 'export const B = 2;');

    const result = buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    expect(result.filesIndexed).toBe(2);
    expect(result.symbolsIndexed).toBeGreaterThanOrEqual(2);
    expect(result.importsIndexed).toBe(1);
  });

  it('reports a missing on-disk index as stale with rebuild instructions available to callers', () => {
    writeFile(tmp, 'core/freshness/a.ts', 'export const FreshnessA = 1;');
    const dbPath = path.join(tmp, 'missing.db');

    const freshness = assessSymbolIndexFreshness({ repoRoot: tmp, dbPath, includeDirs: ['core'] });

    expect(freshness.missing).toBe(true);
    expect(freshness.stale).toBe(true);
    expect(freshness.dbAgeMs).toBe(-1);
  });

  it('marks the index stale when an indexed source file is newer than the DB', () => {
    writeFile(tmp, 'core/freshness/a.ts', 'export const FreshnessA = 1;');
    const dbPath = path.join(tmp, 'freshness.db');
    buildIndex({ repoRoot: tmp, dbPath, includeDirs: ['core'] });

    const dbMtime = new Date(Date.now() - 10_000);
    fs.utimesSync(dbPath, dbMtime, dbMtime);

    const sourceMtime = new Date();
    fs.utimesSync(path.join(tmp, 'core/freshness/a.ts'), sourceMtime, sourceMtime);

    const freshness = assessSymbolIndexFreshness({ repoRoot: tmp, dbPath, includeDirs: ['core'] });

    expect(freshness.missing).toBe(false);
    expect(freshness.stale).toBe(true);
  });

  it('best-effort rebuilds a missing index', () => {
    writeFile(tmp, 'core/freshness/a.ts', 'export const FreshnessA = 1;');
    const dbPath = path.join(tmp, 'freshness.db');

    const result = ensureSymbolIndexFresh({ repoRoot: tmp, dbPath, includeDirs: ['core'] });

    expect(result.rebuilt).toBe(true);
    expect(result.missing).toBe(false);
    expect(result.stale).toBe(false);

    const rebuilt = openIndexDb(dbPath);
    try {
      expect(findSymbol(rebuilt, 'FreshnessA')).toHaveLength(1);
    } finally {
      rebuilt.close();
    }
  });
});
