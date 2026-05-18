#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessSymbolIndexFreshness,
  buildIndex,
  defaultDbPath,
  findCallers,
  findSymbol,
  listExportsOf,
  listImports,
  openIndexDb,
} from '../core/symbol-index/index.js';

type Command = 'find' | 'callers' | 'exports' | 'imports' | 'refresh';

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function usage(exitCode = 2): never {
  console.error(`Usage:
  pnpm symbol find <identifier>
  pnpm symbol callers <identifier>
  pnpm symbol exports <file>
  pnpm symbol imports <file>
  pnpm symbol refresh`);
  process.exit(exitCode);
}

function parseDbFlag(argv: string[]): { dbPath: string; rest: string[] } {
  const idx = argv.indexOf('--db');
  if (idx === -1) return { dbPath: defaultDbPath(), rest: argv };
  const value = argv[idx + 1];
  if (!value) {
    console.error('--db requires a path argument');
    process.exit(2);
  }
  return { dbPath: value, rest: argv.filter((_, i) => i !== idx && i !== idx + 1) };
}

function assertUsableDb(dbPath: string): void {
  const freshness = assessSymbolIndexFreshness({ repoRoot: repoRoot(), dbPath });
  if (freshness.missing) {
    console.error(`symbol-index: DB missing at ${dbPath}. Run pnpm symbol-index.`);
    process.exit(1);
  }
  if (freshness.corrupt) {
    console.error(`symbol-index: DB unreadable at ${dbPath}. Run pnpm symbol-index.`);
    process.exit(1);
  }
  if (freshness.stale) {
    console.error(`symbol-index: DB may be stale at ${dbPath}. Run pnpm symbol-index.`);
  }
}

function refresh(dbPath: string): void {
  const started = Date.now();
  const result = buildIndex({ repoRoot: repoRoot(), dbPath });
  const ms = Date.now() - started;
  console.log(
    `symbol-index: indexed ${result.filesIndexed} files, ${result.symbolsIndexed} symbols, ${result.importsIndexed} imports in ${ms}ms`,
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

  if (!command || !['find', 'callers', 'exports', 'imports'].includes(command) || !arg) usage();
  assertUsableDb(dbPath);

  const db = openIndexDb(dbPath);
  try {
    if (command === 'find') {
      const rows = findSymbol(db, arg);
      if (rows.length === 0) {
        console.log(`no symbol found: ${arg}`);
        return;
      }
      for (const row of rows) {
        console.log(`${row.filePath}:${row.line} ${row.kind} ${row.name} exported=${row.exported}`);
      }
      return;
    }

    if (command === 'callers') {
      const importers = findCallers(db, arg);
      console.log(`importers for ${arg} (static imports, not runtime callers):`);
      if (importers.length === 0) {
        console.log('(none)');
        return;
      }
      for (const importer of importers) console.log(importer);
      return;
    }

    if (command === 'exports') {
      const rows = listExportsOf(db, arg);
      if (rows.length === 0) {
        console.log(`no exports found: ${arg}`);
        return;
      }
      for (const row of rows) {
        console.log(`${row.filePath}:${row.line} ${row.kind} ${row.name} exported=true`);
      }
      return;
    }

    if (command === 'imports') {
      const rows = listImports(db, arg);
      if (rows.length === 0) {
        console.log(`no imports found: ${arg}`);
        return;
      }
      for (const row of rows) {
        console.log(`${row.filePath} imports ${row.importedName} from ${row.sourceModule}`);
      }
    }
  } finally {
    db.close();
  }
}

main();
