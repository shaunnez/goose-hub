import { existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { defaultDbPath, openIndexDb } from './db.js';
import { findCallers, findSymbol } from './query.js';

export interface SymbolHint {
  name: string;
  definedIn: string;
  line: number;
  kind: string;
  callers: string[];
}

export interface LookupOptions {
  dbPath?: string;
  /** When provided, hints are filtered to only files that exist in this directory tree. */
  worktreePath?: string;
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
  const resolved = options?.dbPath ?? defaultDbPath();
  if (!existsSync(resolved)) return [];

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
        if (
          options?.worktreePath !== undefined &&
          !existsSync(path.join(options.worktreePath, sym.filePath))
        ) {
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
