import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildIndex } from './builder.js';
import { openIndexDb } from './db.js';
import { extractIdentifiers, lookupWorkItemSymbols } from './lookup.js';

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
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
    const result = lookupWorkItemSymbols('Fix dispatchWave', 'details', '/nonexistent/path.db');
    expect(result).toEqual([]);
  });

  it('returns [] when no matching symbols found', () => {
    writeFile(tmp, 'core/foo.ts', 'export function unrelatedThing() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix AuthService bug', 'body', dbPath);
    expect(result).toEqual([]);
  });

  it('finds exported symbols matching work item identifiers', () => {
    writeFile(tmp, 'core/auth.ts', 'export function AuthService() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix AuthService crash', 'auth breaks', dbPath);
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

    const result = lookupWorkItemSymbols('Fix AuthService crash', '', dbPath);
    expect(result[0].callers).toContain('core/app.ts');
  });

  it('skips non-exported symbols', () => {
    writeFile(tmp, 'core/auth.ts', 'function internalHelper() {}');
    buildIndex({ repoRoot: tmp, db, includeDirs: ['core'] });
    db.close();

    const result = lookupWorkItemSymbols('Fix internalHelper', '', dbPath);
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

    const result = lookupWorkItemSymbols('Fix SharedUtil', '', dbPath);
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
    const result = lookupWorkItemSymbols(title, '', dbPath);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('returns [] on DB error without throwing', () => {
    // Write a non-SQLite file at the DB path
    fs.writeFileSync(dbPath, 'not a sqlite file');
    const result = lookupWorkItemSymbols('Fix AuthService', '', dbPath);
    expect(result).toEqual([]);
  });
});
