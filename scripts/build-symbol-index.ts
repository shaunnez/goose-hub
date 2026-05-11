#!/usr/bin/env tsx
/**
 * Build (or rebuild) the local symbol index.
 *
 * Usage:
 *   pnpm symbol-index               # writes ~/.factory/symbol-index.db
 *   pnpm symbol-index --db <path>   # write to a custom path
 *
 * The index is regenerable and gitignored. See core/symbol-index/README.md
 * and ADR 0040 for the rationale.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, defaultDbPath } from '../core/symbol-index/index.js';

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
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
  const dbPath = parseDbFlag(process.argv.slice(2)) ?? defaultDbPath();

  const started = Date.now();
  const result = buildIndex({ repoRoot, dbPath });
  const ms = Date.now() - started;

  console.log(
    `symbol-index: indexed ${result.filesIndexed} files, ${result.symbolsIndexed} symbols, ${result.importsIndexed} imports in ${ms}ms`,
  );
  console.log(`  db: ${dbPath}`);
}

main();
