import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { defaultDbPath, openIndexDb, symbolIndexDbPathForWorktree } from './db.js';
import { ensureSymbolIndexFresh } from './freshness.js';
import { findCallers, findCallersOfExport, findSymbol, listExportsOf } from './query.js';
import type { SymbolKind, SymbolRow } from './types.js';

export interface SymbolHint {
  name: string;
  definedIn: string;
  line: number;
  kind: string;
  callers: string[];
}

export type SymbolIndexHintConsumer =
  | 'scout-code-path'
  | 'scout-dependency'
  | 'scout-schema'
  | 'scout-test-inventory';

export interface SymbolHintBoundary {
  packageBoundary: string;
  moduleBoundary: string;
}

export interface ShapedSymbolHint extends SymbolHint {
  importers?: string[];
  boundary?: SymbolHintBoundary;
  nearbyTests?: string[];
}

export interface SymbolKeyFileHint {
  path: string;
  reason: string;
}

export interface SymbolImpact {
  changedExport: string;
  definedIn: string;
  importers: string[];
}

export interface LookupOptions {
  dbPath?: string;
  /** When provided, hints are filtered to only files that exist in this directory tree. */
  worktreePath?: string;
}

export interface LookupSymbolOptions extends LookupOptions {
  kind?: Extract<SymbolKind, 'function' | 'class' | 'type' | 'const' | 'enum' | 'variable'>;
}

const SKIP_WORDS = new Set([
  'the',
  'and',
  'for',
  'this',
  'that',
  'with',
  'from',
  'but',
  'not',
  'has',
  'have',
  'been',
  'when',
  'where',
  'what',
  'which',
  'who',
  'how',
  'are',
  'was',
  'were',
  'will',
  'would',
  'could',
  'should',
  'may',
  'can',
  'fix',
  'bug',
  'add',
  'get',
  'set',
  'use',
  'run',
  'see',
  'new',
  'old',
  'all',
  'any',
  'let',
  'var',
  'null',
  'true',
  'false',
  'void',
  'async',
  'await',
  'return',
  'import',
  'export',
  'default',
  'class',
  'function',
  'interface',
  'type',
  'enum',
  'const',
  'then',
  'else',
]);

const MAX_IDENTIFIERS = 12;
const MAX_HINTS = 20;
const MAX_CALLERS_PER_HINT = 5;
const SCOUT_HINT_CAPS: Record<SymbolIndexHintConsumer, number> = {
  'scout-code-path': 20,
  'scout-dependency': 8,
  'scout-schema': 8,
  'scout-test-inventory': 8,
};
const MAX_NEARBY_TESTS_PER_HINT = 3;
const MAX_SYMBOL_KEY_FILES = 8;
const MAX_IMPORTER_KEY_FILES = 2;
const MAX_SYMBOL_IMPACT = 8;
const MAX_IMPORTERS_PER_IMPACT = 5;
const SCHEMA_SYMBOL_NAME_RE =
  /(schema|table|payload|contract|settings|config|state|event|input|output|row|record|entity|definition|defs)$/i;
const SCHEMA_SYMBOL_KINDS = new Set(['interface', 'type', 'enum']);

function resolveDbPath(options: LookupOptions | undefined): {
  dbPath: string;
  shouldEnsureWorktreeFresh: boolean;
} {
  if (options?.dbPath != null) return { dbPath: options.dbPath, shouldEnsureWorktreeFresh: false };
  if (options?.worktreePath != null) {
    return {
      dbPath: symbolIndexDbPathForWorktree(options.worktreePath),
      shouldEnsureWorktreeFresh: true,
    };
  }
  return { dbPath: defaultDbPath(), shouldEnsureWorktreeFresh: false };
}

function prepareReadableDbPath(options: LookupOptions | undefined): string | null {
  const resolved = resolveDbPath(options);
  if (resolved.shouldEnsureWorktreeFresh) {
    if (options?.worktreePath == null) return null;
    try {
      const freshness = ensureSymbolIndexFresh({
        repoRoot: options.worktreePath,
        dbPath: resolved.dbPath,
      });
      if (freshness.missing || freshness.stale || freshness.corrupt || freshness.error != null) {
        return null;
      }
    } catch {
      return null;
    }
    return resolved.dbPath;
  }
  return existsSync(resolved.dbPath) ? resolved.dbPath : null;
}

export function extractIdentifiers(text: string): string[] {
  // Backtick spans are high-confidence code references — extract identifier tokens from them first
  const backtickIds: string[] = [];
  for (const [, inner] of text.matchAll(/`([^`]+)`/g)) {
    if (!inner) continue;
    // Parse valid identifier tokens out of the span (handles `fn()`, `Type.method`, etc.)
    const tokens = inner.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g) ?? [];
    backtickIds.push(...tokens);
  }

  // Then camelCase / PascalCase / snake_case tokens from the full text
  const allTokens = text.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g) ?? [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of [...backtickIds, ...allTokens]) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (SKIP_WORDS.has(token.toLowerCase())) continue;
    // Require at least one uppercase letter or underscore — filters prose
    const looksLikeCode = /[A-Z]/.test(token) || token.includes('_') || /[a-z][A-Z]/.test(token);
    if (!looksLikeCode) continue;
    result.push(token);
    if (result.length >= MAX_IDENTIFIERS) break;
  }
  return result;
}

function symbolExistsInWorktree(filePath: string, worktreePath: string | undefined): boolean {
  return worktreePath === undefined || existsSync(path.join(worktreePath, filePath));
}

function classifyBoundary(filePath: string): SymbolHintBoundary {
  const parts = filePath.split('/');
  const [top, second, third] = parts;
  if (top === 'apps' && second != null) {
    return {
      packageBoundary: `apps/${second}`,
      moduleBoundary: third != null ? `apps/${second}/${third}` : `apps/${second}`,
    };
  }
  if ((top === 'skills' || top === 'slices') && second != null) {
    return {
      packageBoundary: `${top}/${second}`,
      moduleBoundary: `${top}/${second}`,
    };
  }
  if (top === 'core') {
    return {
      packageBoundary: 'core',
      moduleBoundary: second != null ? `core/${second}` : 'core',
    };
  }
  return {
    packageBoundary: top ?? filePath,
    moduleBoundary: second != null ? `${top}/${second}` : (top ?? filePath),
  };
}

function findNearbyTestFiles(filePath: string, worktreePath: string | undefined): string[] {
  if (worktreePath === undefined) return [];
  const dir = path.posix.dirname(filePath);
  const absDir = path.join(worktreePath, dir);
  if (!existsSync(absDir)) return [];

  const stem = path.posix.basename(filePath).replace(/\.[^.]+$/, '');
  try {
    return readdirSync(absDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
      .map((entry) => path.posix.join(dir, entry.name))
      .sort((a, b) => {
        const aSameStem = path.posix.basename(a).startsWith(`${stem}.`) ? 0 : 1;
        const bSameStem = path.posix.basename(b).startsWith(`${stem}.`) ? 0 : 1;
        return aSameStem - bSameStem || a.localeCompare(b);
      })
      .slice(0, MAX_NEARBY_TESTS_PER_HINT);
  } catch {
    return [];
  }
}

function isSchemaSymbol(hint: SymbolHint): boolean {
  return SCHEMA_SYMBOL_KINDS.has(hint.kind) || SCHEMA_SYMBOL_NAME_RE.test(hint.name);
}

export function shapeSymbolIndexHintsForScout(
  hints: SymbolHint[],
  consumer: SymbolIndexHintConsumer,
  options?: { worktreePath?: string; maxHints?: number },
): ShapedSymbolHint[] {
  const maxHints = options?.maxHints ?? SCOUT_HINT_CAPS[consumer];
  const scopedHints =
    consumer === 'scout-schema' ? hints.filter((hint) => isSchemaSymbol(hint)) : hints;

  return scopedHints.slice(0, maxHints).map((hint) => {
    if (consumer === 'scout-code-path') return { ...hint };
    if (consumer === 'scout-dependency') {
      return {
        ...hint,
        importers: hint.callers,
        boundary: classifyBoundary(hint.definedIn),
      };
    }
    if (consumer === 'scout-test-inventory') {
      return {
        ...hint,
        importers: hint.callers,
        nearbyTests: findNearbyTestFiles(hint.definedIn, options?.worktreePath),
      };
    }
    return { ...hint };
  });
}

export function symbolHintsToKeyFiles(
  hints: SymbolHint[],
  options?: { existingPaths?: Iterable<string>; maxFiles?: number },
): SymbolKeyFileHint[] {
  const existing = new Set(options?.existingPaths ?? []);
  const maxFiles = options?.maxFiles ?? MAX_SYMBOL_KEY_FILES;
  const out: SymbolKeyFileHint[] = [];
  const seen = new Set(existing);

  const push = (pathValue: string, reason: string): void => {
    if (seen.has(pathValue) || out.length >= maxFiles) return;
    seen.add(pathValue);
    out.push({ path: pathValue, reason });
  };

  for (const hint of hints) {
    push(hint.definedIn, `Symbol index: ${hint.name} is exported here`);
    for (const importer of hint.callers.slice(0, MAX_IMPORTER_KEY_FILES)) {
      push(importer, `Symbol index: imports ${hint.name}`);
    }
    if (out.length >= maxFiles) break;
  }

  return out;
}

export function lookupChangedExportImpact(
  changedFiles: string[],
  options?: LookupOptions & { maxImpacts?: number },
): SymbolImpact[] {
  const resolved = prepareReadableDbPath(options);
  if (resolved == null) return [];

  let db: Database.Database | null = null;
  try {
    db = openIndexDb(resolved);
    const impacts: SymbolImpact[] = [];
    const seen = new Set<string>();

    for (const filePath of changedFiles) {
      if (!/\.(ts|tsx)$/.test(filePath)) continue;
      for (const sym of listExportsOf(db, filePath)) {
        const key = `${sym.filePath}:${sym.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const importers = findCallersOfExport(db, sym.filePath, sym.name)
          .filter((importer) => importer !== sym.filePath)
          .filter((importer) => symbolExistsInWorktree(importer, options?.worktreePath))
          .slice(0, MAX_IMPORTERS_PER_IMPACT);
        if (importers.length === 0) continue;
        impacts.push({
          changedExport: sym.name,
          definedIn: sym.filePath,
          importers,
        });
        if (impacts.length >= (options?.maxImpacts ?? MAX_SYMBOL_IMPACT)) return impacts;
      }
    }

    return impacts;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export function lookupSymbol(name: string, options?: LookupSymbolOptions): SymbolRow[] {
  const resolved = prepareReadableDbPath(options);
  if (resolved == null) return [];

  let db: Database.Database | null = null;
  try {
    db = openIndexDb(resolved);
    return findSymbol(db, name)
      .filter((symbol) => options?.kind == null || symbol.kind === options.kind)
      .filter((symbol) => symbolExistsInWorktree(symbol.filePath, options?.worktreePath));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export function findCallersOfSymbol(symbol: string, options?: LookupOptions): string[] {
  const resolved = prepareReadableDbPath(options);
  if (resolved == null) return [];

  let db: Database.Database | null = null;
  try {
    db = openIndexDb(resolved);
    const callers = new Set<string>();
    for (const exported of findSymbol(db, symbol).filter((row) => row.exported)) {
      for (const caller of findCallersOfExport(db, exported.filePath, symbol)) {
        if (!symbolExistsInWorktree(caller, options?.worktreePath)) continue;
        callers.add(caller);
      }
    }
    return [...callers].sort();
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/**
 * Query the local symbol index for identifiers mentioned in a work item.
 * Returns [] gracefully when the index file is absent, empty, or errored.
 *
 * Pass `worktreePath` to restrict hints to files that actually exist in the
 * active worktree — prevents Goose Hub-internal paths from leaking into
 * investigations against unrelated target repos.
 */
export function lookupWorkItemSymbols(
  title: string,
  body: string,
  options?: LookupOptions,
): SymbolHint[] {
  const resolved = prepareReadableDbPath(options);
  if (resolved == null) return [];

  let db: Database.Database | null = null;
  try {
    db = openIndexDb(resolved);
    const identifiers = extractIdentifiers(`${title} ${body}`);
    const hints: SymbolHint[] = [];
    const seen = new Set<string>();

    for (const name of identifiers) {
      const exported = findSymbol(db, name).filter((s) => s.exported);
      // Only include callers when the name is unambiguous — multiple exports with
      // the same name would merge unrelated caller sets.
      const callers =
        exported.length === 1 ? findCallers(db, name).slice(0, MAX_CALLERS_PER_HINT) : [];

      for (const sym of exported) {
        // Skip hints whose source file doesn't exist in the active worktree.
        // This prevents Goose Hub-internal paths from appearing in investigations
        // against unrelated target repos.
        if (!symbolExistsInWorktree(sym.filePath, options?.worktreePath)) {
          continue;
        }

        const key = `${sym.filePath}:${sym.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push({
          name: sym.name,
          definedIn: sym.filePath,
          line: sym.line,
          kind: sym.kind,
          callers,
        });
        if (hints.length >= MAX_HINTS) break;
      }
      if (hints.length >= MAX_HINTS) break;
    }
    return hints;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
