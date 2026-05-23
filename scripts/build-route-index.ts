#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRouteIndex, defaultRouteIndexDbPath } from '../core/route-index/index.js';

function parseDbFlag(argv: string[]): string | undefined {
  const idx = argv.indexOf('--db');
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value) {
    console.error('--db requires a path argument');
    process.exit(2);
  }
  return value;
}

function main(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dbPath = parseDbFlag(process.argv.slice(2)) ?? defaultRouteIndexDbPath();
  const started = Date.now();
  const result = buildRouteIndex({ repoRoot, dbPath });
  const ms = Date.now() - started;
  console.log(
    `route-index: indexed ${result.filesIndexed} files, ${result.routesIndexed} routes, ${result.componentUsagesIndexed} component usages in ${ms}ms`,
  );
  console.log(`  db: ${dbPath}`);
}

main();
