import { buildRouteIndex } from './builder.js';
import { openRouteIndexDb } from './db.js';
import { ensureRouteIndexFresh } from './freshness.js';
import type { ComponentUsageRow, RouteRow } from './types.js';

interface LookupOptions {
  dbPath?: string;
  worktreePath?: string;
}

interface RouteRowDb {
  path_pattern: string;
  file_path: string;
  line: number;
  component: string | null;
}

interface ComponentUsageRowDb {
  component: string;
  file_path: string;
  line: number;
}

function routeRow(row: RouteRowDb): RouteRow {
  return {
    pathPattern: row.path_pattern,
    filePath: row.file_path,
    line: row.line,
    ...(row.component != null ? { component: row.component } : {}),
  };
}

function componentRow(row: ComponentUsageRowDb): ComponentUsageRow {
  return { component: row.component, filePath: row.file_path, line: row.line };
}

function withFreshDb<T>(
  options: LookupOptions,
  query: (db: ReturnType<typeof openRouteIndexDb>) => T,
): T | null {
  if (options.worktreePath != null) {
    const freshness = ensureRouteIndexFresh({
      repoRoot: options.worktreePath,
      dbPath: options.dbPath,
      rebuild: (repoRoot, dbPath) => buildRouteIndex({ repoRoot, dbPath }),
    });
    if (freshness.missing || freshness.stale || freshness.corrupt) return null;
  }
  let db: ReturnType<typeof openRouteIndexDb>;
  try {
    db = openRouteIndexDb(options.dbPath);
  } catch {
    return null;
  }
  try {
    return query(db);
  } finally {
    db.close();
  }
}

export function lookupRoute(pathPattern: string, options: LookupOptions = {}): RouteRow[] | null {
  return withFreshDb(options, (db) =>
    (
      db
        .prepare(
          'SELECT path_pattern, file_path, line, component FROM routes WHERE path_pattern = ? ORDER BY file_path, line',
        )
        .all(pathPattern) as RouteRowDb[]
    ).map(routeRow),
  );
}

export function findComponentUsages(
  componentName: string,
  options: LookupOptions = {},
): ComponentUsageRow[] | null {
  return withFreshDb(options, (db) =>
    (
      db
        .prepare(
          'SELECT component, file_path, line FROM component_usages WHERE component = ? ORDER BY file_path, line',
        )
        .all(componentName) as ComponentUsageRowDb[]
    ).map(componentRow),
  );
}

export function routeForComponent(
  component: string,
  options: LookupOptions = {},
): RouteRow[] | null {
  return withFreshDb(options, (db) =>
    (
      db
        .prepare(
          `SELECT r.path_pattern, r.file_path, r.line, r.component
           FROM routes r
           WHERE r.component = ?
           ORDER BY r.file_path, r.line`,
        )
        .all(component) as RouteRowDb[]
    ).map(routeRow),
  );
}

const COMPONENT_TOKEN_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'for',
  'page',
  'view',
  'widget',
  'button',
  'panel',
  'window',
  'component',
]);

function tokenizePhrase(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !COMPONENT_TOKEN_STOPWORDS.has(token));
}

export interface FuzzyComponentMatch {
  component: string;
  filePath: string;
  line: number;
  score: number;
}

/**
 * Returns components whose name contains one or more tokens extracted from
 * `phrase`. Used to ground UI bug reports ("the chat widget", "settings
 * page") to concrete component files when investigation has nothing else.
 *
 * Scoring is the count of matching tokens (case-insensitive substring).
 * Stop-words ("widget", "panel", "page", …) are dropped before matching so
 * generic phrasing doesn't dominate.
 */
export function fuzzyFindComponents(
  phrase: string,
  options: LookupOptions & { limit?: number } = {},
): FuzzyComponentMatch[] | null {
  const tokens = tokenizePhrase(phrase);
  if (tokens.length === 0) return [];
  const limit = options.limit ?? 10;
  return withFreshDb(options, (db) => {
    const rows = db
      .prepare('SELECT component, file_path, line FROM component_usages ORDER BY file_path, line')
      .all() as ComponentUsageRowDb[];
    const scored: FuzzyComponentMatch[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.component.toLowerCase();
      let score = 0;
      for (const token of tokens) if (name.includes(token)) score += 1;
      if (score === 0) continue;
      const dedupeKey = `${row.component}:${row.file_path}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      scored.push({
        component: row.component,
        filePath: row.file_path,
        line: row.line,
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));
    return scored.slice(0, limit);
  });
}

/**
 * Matches a URL (or repo-relative path) against the indexed routes. The
 * URL's scheme + host are stripped; the remaining path is normalized and
 * compared against each `path_pattern` after parameter expansion
 * (`:slug` segments accept any non-slash characters).
 */
export function lookupRouteForUrl(url: string, options: LookupOptions = {}): RouteRow[] | null {
  const targetPath = normalizeRouteInputPath(url);
  if (targetPath == null) return [];
  return withFreshDb(options, (db) => {
    const rows = db
      .prepare(
        'SELECT path_pattern, file_path, line, component FROM routes ORDER BY file_path, line',
      )
      .all() as RouteRowDb[];
    const matches: RouteRow[] = [];
    for (const row of rows) {
      if (routePatternMatches(row.path_pattern, targetPath)) matches.push(routeRow(row));
    }
    return matches;
  });
}

function normalizeRouteInputPath(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  let candidate = trimmed;
  try {
    if (/^https?:\/\//i.test(candidate)) {
      candidate = new URL(candidate).pathname;
    }
  } catch {
    return null;
  }
  if (candidate.length === 0) return null;
  candidate = candidate.split('?')[0].split('#')[0];
  if (!candidate.startsWith('/')) candidate = `/${candidate}`;
  if (candidate.length > 1 && candidate.endsWith('/')) candidate = candidate.slice(0, -1);
  return candidate;
}

function routePatternMatches(pattern: string, target: string): boolean {
  if (pattern === target) return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*')}$`);
  return regex.test(target);
}
