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
): T {
  if (options.worktreePath != null) {
    ensureRouteIndexFresh({
      repoRoot: options.worktreePath,
      dbPath: options.dbPath,
      rebuild: (repoRoot, dbPath) => buildRouteIndex({ repoRoot, dbPath }),
    });
  }
  const db = openRouteIndexDb(options.dbPath);
  try {
    return query(db);
  } finally {
    db.close();
  }
}

export function lookupRoute(pathPattern: string, options: LookupOptions = {}): RouteRow[] {
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
): ComponentUsageRow[] {
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

export function routeForComponent(component: string, options: LookupOptions = {}): RouteRow[] {
  return withFreshDb(options, (db) =>
    (
      db
        .prepare(
          `SELECT DISTINCT r.path_pattern, r.file_path, r.line, r.component
           FROM routes r
           LEFT JOIN component_usages u ON u.file_path = r.file_path
           WHERE r.component = ? OR u.component = ?
           ORDER BY r.file_path, r.line`,
        )
        .all(component, component) as RouteRowDb[]
    ).map(routeRow),
  );
}
