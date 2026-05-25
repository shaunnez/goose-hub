import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildIndex } from './builder.js';
import { defaultDbPath, openIndexDb, symbolIndexDbPathForWorktree } from './db.js';
import {
  extractIdentifiers,
  lookupChangedExportImpact,
  lookupSymbol,
  lookupWorkItemSymbols,
  shapeSymbolIndexHintsForScout,
  symbolHintsToKeyFiles,
} from './lookup.js';

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function fileMtime(pathValue: string): number | null {
  return fs.existsSync(pathValue) ? fs.statSync(pathValue).mtimeMs : null;
}

describe('extractIdentifiers', () => {
  it('extracts camelCase identifiers', () => {
    const ids = extractIdentifiers('Fix dispatchWave timeout handling');
    expect(ids).toContain('dispatchWave');
  });

  it('extracts PascalCase identifiers', () => {
    const ids = extractIdentifiers('ClaudeCliRuntime crashes on auth');
    expect(ids).toContain('ClaudeCliRuntime');
  });

  it('extracts snake_case identifiers', () => {
    const ids = extractIdentifiers('Update select_persona to round-robin');
    expect(ids).toContain('select_persona');
  });

  it('prioritises backtick-quoted identifiers', () => {
    const ids = extractIdentifiers('Fix bug in `invokeSkill` function');
    expect(ids[0]).toBe('invokeSkill');
  });

  it('skips common prose words', () => {
    const ids = extractIdentifiers('Fix the bug when it has been null');
    expect(ids).not.toContain('the');
    expect(ids).not.toContain('has');
    expect(ids).not.toContain('been');
    expect(ids).not.toContain('null');
  });

  it('skips lowercase-only tokens', () => {
    const ids = extractIdentifiers('resolve issue with timeout error');
    expect(ids).not.toContain('resolve');
    expect(ids).not.toContain('issue');
    expect(ids).not.toContain('timeout');
    expect(ids).not.toContain('error');
  });

  it('caps output at 12 identifiers', () => {
    const text =
      'Fix AuthService UserService TaskService ProjectService ScoutService AgentService EventStore PersonaStore WorkspaceManager BudgetResolver ModelSelector';
    const ids = extractIdentifiers(text);
    expect(ids.length).toBeLessThanOrEqual(12);
  });

  it('deduplicates identifiers', () => {
    const ids = extractIdentifiers('dispatchWave calls dispatchWave recursively');
    expect(ids.filter((id) => id === 'dispatchWave')).toHaveLength(1);
  });
});

describe('lookupWorkItemSymbols', () => {
  let tmp: string;
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-lookup-'));
    dbPath = path.join(tmp, 'symbol-index.db');
    db = openIndexDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns [] when the DB file does not exist', () => {
    const result = lookupWorkItemSymbols('Fix dispatchWave', 'details', {
      dbPath: '/nonexistent/path.db',
    });
    expect(result).toEqual([]);
  });

  it('returns [] when no matching symbols found', () => {
    writeFile(tmp, 'core/foo.ts', 'export function unrelatedThing() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix AuthService bug', 'body', { dbPath });
    expect(result).toEqual([]);
  });

  it('finds exported symbols matching work item identifiers', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix AuthService crash', 'auth breaks', { dbPath });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('AuthService');
    expect(result[0].definedIn).toBe('core/auth.ts');
    expect(result[0].kind).toBe('function');
  });

  it('populates callers list', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    writeFile(tmp, 'core/app.ts', `import { AuthService } from './auth.js'; AuthService();`);
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix AuthService crash', '', { dbPath });
    expect(result[0].callers).toContain('core/app.ts');
  });

  it('skips non-exported symbols', () => {
    writeFile(tmp, 'core/auth.ts', 'function internalHelper() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix internalHelper', '', { dbPath });
    expect(result).toHaveLength(0);
  });

  it('caps callers at 5 per hint', () => {
    writeFile(tmp, 'core/shared.ts', 'export function SharedUtil() {}');
    for (let i = 0; i < 8; i++) {
      writeFile(
        tmp,
        `core/caller${i}.ts`,
        `import { SharedUtil } from './shared.js'; SharedUtil();`,
      );
    }
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix SharedUtil', '', { dbPath });
    expect(result[0].callers.length).toBeLessThanOrEqual(5);
  });

  it('caps total hints at 20', () => {
    for (let i = 0; i < 25; i++) {
      writeFile(tmp, `core/sym${i}.ts`, `export function Symbol${i}() {}`);
    }
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    // Use backtick-quoted identifiers to ensure high extraction confidence
    const title = Array.from({ length: 12 }, (_, i) => `\`Symbol${i}\``).join(' ');
    const result = lookupWorkItemSymbols(title, '', { dbPath });
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('returns [] on DB error without throwing', () => {
    // Write a non-SQLite file at the DB path
    fs.writeFileSync(dbPath, 'not a sqlite file');
    const result = lookupWorkItemSymbols('Fix AuthService', '', { dbPath });
    expect(result).toEqual([]);
  });

  it('worktreePath guard: excludes hints whose definedIn does not exist in worktree', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    // Use a worktreePath that does NOT contain core/auth.ts
    const emptyWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-wt-'));
    try {
      const result = lookupWorkItemSymbols('Fix AuthService', '', {
        dbPath,
        worktreePath: emptyWorktree,
      });
      expect(result).toHaveLength(0);
    } finally {
      fs.rmSync(emptyWorktree, { recursive: true, force: true });
    }
  });

  it('worktreePath guard: includes hints when definedIn exists in worktree', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    // tmp is also the worktree root — core/auth.ts exists there
    const result = lookupWorkItemSymbols('Fix AuthService', '', {
      dbPath,
      worktreePath: tmp,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('AuthService');
  });

  it('uses a per-worktree DB for symbol lookup when worktreePath is provided without dbPath', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');

    const result = lookupSymbol('AuthService', { worktreePath: tmp });

    expect(result).toMatchObject([
      {
        name: 'AuthService',
        filePath: 'core/auth.ts',
        kind: 'function',
        exported: true,
      },
    ]);
    expect(fs.existsSync(symbolIndexDbPathForWorktree(tmp))).toBe(true);
  });

  it('uses a per-worktree DB for work item symbol hints when worktreePath is provided without dbPath', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');

    const result = lookupWorkItemSymbols('Fix AuthService', '', { worktreePath: tmp });

    expect(result).toMatchObject([
      {
        name: 'AuthService',
        definedIn: 'core/auth.ts',
      },
    ]);
    expect(fs.existsSync(symbolIndexDbPathForWorktree(tmp))).toBe(true);
  });

  it('lazily rebuilds a stale per-worktree symbol DB', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    expect(lookupSymbol('AuthService', { worktreePath: tmp })).toHaveLength(1);

    writeFile(tmp, 'core/session.ts', 'export function SessionService() {}');
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(symbolIndexDbPathForWorktree(tmp), past, past);

    const result = lookupSymbol('SessionService', { worktreePath: tmp });

    expect(result).toMatchObject([
      {
        name: 'SessionService',
        filePath: 'core/session.ts',
      },
    ]);
  });

  it('isolates per-worktree symbol indexes and does not touch the global symbol DB', () => {
    const globalBefore = fileMtime(defaultDbPath());
    const worktreeA = path.join(tmp, 'worktree-a');
    const worktreeB = path.join(tmp, 'worktree-b');
    writeFile(worktreeA, 'core/a.ts', 'export function AlphaService() {}');
    writeFile(worktreeB, 'core/b.ts', 'export function BetaService() {}');

    expect(lookupSymbol('AlphaService', { worktreePath: worktreeA })).toMatchObject([
      { name: 'AlphaService', filePath: 'core/a.ts' },
    ]);
    expect(lookupSymbol('BetaService', { worktreePath: worktreeA })).toEqual([]);
    expect(lookupSymbol('BetaService', { worktreePath: worktreeB })).toMatchObject([
      { name: 'BetaService', filePath: 'core/b.ts' },
    ]);
    expect(lookupSymbol('AlphaService', { worktreePath: worktreeB })).toEqual([]);
    expect(fileMtime(defaultDbPath())).toBe(globalBefore);
  });

  it('returns [] without throwing when the per-worktree symbol DB cannot be rebuilt', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    fs.writeFileSync(path.join(tmp, '.factory'), 'not a directory', 'utf8');

    expect(lookupSymbol('AuthService', { worktreePath: tmp })).toEqual([]);
  });

  it('returns empty callers when same name exported from multiple files', () => {
    writeFile(tmp, 'core/a.ts', 'export function Config() {}');
    writeFile(tmp, 'core/b.ts', 'export function Config() {}');
    writeFile(tmp, 'core/app.ts', `import { Config } from './a.js';`);
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix Config', '', { dbPath });
    // Two symbols named Config — callers are ambiguous
    for (const hint of result) {
      expect(hint.callers).toHaveLength(0);
    }
  });

  it('includes callers when name is unambiguous', () => {
    writeFile(tmp, 'core/auth.ts', 'export function UniqueService() {}');
    writeFile(tmp, 'core/app.ts', `import { UniqueService } from './auth.js';`);
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix UniqueService', '', { dbPath });
    expect(result[0].callers).toContain('core/app.ts');
  });

  it('extracts identifier tokens from backtick spans containing punctuation', () => {
    const ids = extractIdentifiers('fix `dispatchWave()` and `AuthService.login`');
    expect(ids).toContain('dispatchWave');
    expect(ids).toContain('AuthService');
    // The punctuation-bearing spans should not appear as-is
    expect(ids).not.toContain('dispatchWave()');
    expect(ids).not.toContain('AuthService.login');
  });

  it('shapes dependency hints with importers and boundaries under a separate cap', () => {
    const hints = Array.from({ length: 10 }, (_, i) => ({
      name: `Symbol${i}`,
      definedIn: `core/agent-runtime/symbol-${i}.ts`,
      line: 1,
      kind: 'function',
      callers: [`slices/investigate/caller-${i}.ts`],
    }));

    const shaped = shapeSymbolIndexHintsForScout(hints, 'scout-dependency');

    expect(shaped).toHaveLength(8);
    expect(shaped[0].importers).toEqual(['slices/investigate/caller-0.ts']);
    expect(shaped[0].boundary).toEqual({
      packageBoundary: 'core',
      moduleBoundary: 'core/agent-runtime',
    });
  });

  it('limits schema hints to exported schema/type/table-shaped symbols', () => {
    const shaped = shapeSymbolIndexHintsForScout(
      [
        {
          name: 'dispatchWave',
          definedIn: 'core/agent-runtime/swarm.ts',
          line: 1,
          kind: 'function',
          callers: [],
        },
        {
          name: 'DevReviewContextSchema',
          definedIn: 'skills/dev-review/schema.ts',
          line: 1,
          kind: 'const',
          callers: [],
        },
        {
          name: 'WorkItem',
          definedIn: 'core/state-source/interface.ts',
          line: 1,
          kind: 'interface',
          callers: [],
        },
      ],
      'scout-schema',
    );

    expect(shaped.map((hint) => hint.name)).toEqual(['DevReviewContextSchema', 'WorkItem']);
  });

  it('adds nearby tests for test inventory hints', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    writeFile(tmp, 'core/auth.test.ts', 'test("auth", () => {})');
    writeFile(tmp, 'core/slice.test.ts', 'test("slice", () => {})');

    const shaped = shapeSymbolIndexHintsForScout(
      [
        {
          name: 'AuthService',
          definedIn: 'core/auth.ts',
          line: 1,
          kind: 'function',
          callers: ['core/app.ts'],
        },
      ],
      'scout-test-inventory',
      { worktreePath: tmp },
    );

    expect(shaped[0].importers).toEqual(['core/app.ts']);
    expect(shaped[0].nearbyTests).toEqual(['core/auth.test.ts', 'core/slice.test.ts']);
  });

  it('turns symbol hints into capped key files without duplicating investigation files', () => {
    const keyFiles = symbolHintsToKeyFiles(
      [
        {
          name: 'dispatchWave',
          definedIn: 'core/agent-runtime/swarm.ts',
          line: 1,
          kind: 'function',
          callers: ['slices/investigate/workflow.ts', 'slices/parallel-implement/workflow.ts'],
        },
      ],
      { existingPaths: ['core/agent-runtime/swarm.ts'], maxFiles: 3 },
    );

    expect(keyFiles).toEqual([
      {
        path: 'slices/investigate/workflow.ts',
        reason: 'Symbol index: imports dispatchWave',
      },
      {
        path: 'slices/parallel-implement/workflow.ts',
        reason: 'Symbol index: imports dispatchWave',
      },
    ]);
  });

  it('builds capped changed-export impact for dev-review consumers', () => {
    writeFile(tmp, 'core/swarm.ts', 'export function dispatchWave() {}');
    writeFile(
      tmp,
      'slices/investigate/workflow.ts',
      `import { dispatchWave } from '../../core/swarm.js';`,
    );
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core', 'slices'] });
    db.close();

    const impact = lookupChangedExportImpact(['core/swarm.ts'], {
      dbPath,
      worktreePath: tmp,
    });

    expect(impact).toEqual([
      {
        changedExport: 'dispatchWave',
        definedIn: 'core/swarm.ts',
        importers: ['slices/investigate/workflow.ts'],
      },
    ]);
  });

  it('includes deleted changed files in changed-export impact', () => {
    writeFile(tmp, 'core/deleted.ts', 'export function DeletedService() {}');
    writeFile(
      tmp,
      'slices/investigate/workflow.ts',
      `import { DeletedService } from '../../core/deleted.js';`,
    );
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core', 'slices'] });
    db.close();
    fs.rmSync(path.join(tmp, 'core/deleted.ts'));

    const impact = lookupChangedExportImpact(['core/deleted.ts'], {
      dbPath,
      worktreePath: tmp,
    });

    expect(impact).toEqual([
      {
        changedExport: 'DeletedService',
        definedIn: 'core/deleted.ts',
        importers: ['slices/investigate/workflow.ts'],
      },
    ]);
  });

  it('scopes changed-export impact to importers of the defining module', () => {
    writeFile(tmp, 'core/a/config.ts', 'export function Config() {}');
    writeFile(tmp, 'core/b/config.ts', 'export function Config() {}');
    writeFile(tmp, 'slices/a/workflow.ts', `import { Config } from '../../core/a/config.js';`);
    writeFile(tmp, 'slices/b/workflow.ts', `import { Config } from '../../core/b/config.js';`);
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core', 'slices'] });
    db.close();

    const impact = lookupChangedExportImpact(['core/a/config.ts'], {
      dbPath,
      worktreePath: tmp,
    });

    expect(impact).toEqual([
      {
        changedExport: 'Config',
        definedIn: 'core/a/config.ts',
        importers: ['slices/a/workflow.ts'],
      },
    ]);
  });

  it('filters changed-export importers that are absent from the worktree', () => {
    writeFile(tmp, 'core/swarm.ts', 'export function dispatchWave() {}');
    writeFile(
      tmp,
      'slices/investigate/workflow.ts',
      `import { dispatchWave } from '../../core/swarm.js';`,
    );
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core', 'slices'] });
    db.close();
    fs.rmSync(path.join(tmp, 'slices/investigate/workflow.ts'));

    const impact = lookupChangedExportImpact(['core/swarm.ts'], {
      dbPath,
      worktreePath: tmp,
    });

    expect(impact).toEqual([]);
  });
});
