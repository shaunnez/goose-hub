#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRouteIndex,
  defaultRouteIndexDbPath,
  findComponentUsages,
  lookupRoute,
  routeForComponent,
} from '../core/route-index/index.js';

type Command = 'find' | 'component' | 'route-for-component' | 'refresh';

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function usage(exitCode = 2): never {
  console.error(`Usage:
  pnpm route find <path-pattern>
  pnpm route component <component-name>
  pnpm route route-for-component <component-name>
  pnpm route refresh`);
  process.exit(exitCode);
}

function parseDbFlag(argv: string[]): { dbPath: string; rest: string[] } {
  const idx = argv.indexOf('--db');
  if (idx === -1) return { dbPath: defaultRouteIndexDbPath(), rest: argv };
  const value = argv[idx + 1];
  if (!value) {
    console.error('--db requires a path argument');
    process.exit(2);
  }
  return { dbPath: value, rest: argv.filter((_, i) => i !== idx && i !== idx + 1) };
}

function refresh(dbPath: string): void {
  const started = Date.now();
  const result = buildRouteIndex({ repoRoot: repoRoot(), dbPath });
  const ms = Date.now() - started;
  console.log(
    `route-index: indexed ${result.filesIndexed} files, ${result.routesIndexed} routes, ${result.componentUsagesIndexed} component usages in ${ms}ms`,
  );
  console.log(`db: ${dbPath}`);
}

function main(): void {
  const { dbPath, rest } = parseDbFlag(process.argv.slice(2));
  const [rawCommand, arg] = rest;
  const command = rawCommand as Command | undefined;
  if (command === 'refresh') {
    refresh(dbPath);
    return;
  }
  if (!command || !['find', 'component', 'route-for-component'].includes(command) || !arg) usage();

  if (command === 'find') {
    const rows = lookupRoute(arg, { dbPath, worktreePath: repoRoot() });
    for (const row of rows) console.log(`${row.pathPattern} ${row.filePath}:${row.line} ${row.component ?? ''}`);
    return;
  }
  if (command === 'component') {
    const rows = findComponentUsages(arg, { dbPath, worktreePath: repoRoot() });
    for (const row of rows) console.log(`${row.component} ${row.filePath}:${row.line}`);
    return;
  }
  const rows = routeForComponent(arg, { dbPath, worktreePath: repoRoot() });
  for (const row of rows) console.log(`${row.pathPattern} ${row.filePath}:${row.line} ${row.component ?? ''}`);
}

main();
