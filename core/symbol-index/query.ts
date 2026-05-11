import type Database from 'better-sqlite3';
import type { ImportRow, SymbolKind, SymbolRow } from './types.js';

interface SymbolRowDb {
  file_path: string;
  name: string;
  kind: string;
  line: number;
  exported: number;
}

interface ImportRowDb {
  file_path: string;
  source_module: string;
  imported_name: string;
}

function toSymbolRow(r: SymbolRowDb): SymbolRow {
  return {
    filePath: r.file_path,
    name: r.name,
    kind: r.kind as SymbolKind,
    line: r.line,
    exported: r.exported === 1,
  };
}

function toImportRow(r: ImportRowDb): ImportRow {
  return {
    filePath: r.file_path,
    sourceModule: r.source_module,
    importedName: r.imported_name,
  };
}

/** All symbols (exported or not) whose name matches exactly. */
export function findSymbol(db: Database.Database, name: string): SymbolRow[] {
  const rows = db
    .prepare(
      'SELECT file_path, name, kind, line, exported FROM symbols WHERE name = ? ORDER BY file_path, line',
    )
    .all(name) as SymbolRowDb[];
  return rows.map(toSymbolRow);
}

/** Files that import the given symbol name. */
export function findCallers(db: Database.Database, name: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT file_path FROM imports WHERE imported_name = ? ORDER BY file_path')
    .all(name) as Array<{ file_path: string }>;
  return rows.map((r) => r.file_path);
}

/** Exported symbols from a single file. */
export function listExportsOf(db: Database.Database, filePath: string): SymbolRow[] {
  const rows = db
    .prepare(
      'SELECT file_path, name, kind, line, exported FROM symbols WHERE file_path = ? AND exported = 1 ORDER BY line',
    )
    .all(filePath) as SymbolRowDb[];
  return rows.map(toSymbolRow);
}

/** All imports declared in a single file. */
export function listImports(db: Database.Database, filePath: string): ImportRow[] {
  const rows = db
    .prepare(
      'SELECT file_path, source_module, imported_name FROM imports WHERE file_path = ? ORDER BY source_module, imported_name',
    )
    .all(filePath) as ImportRowDb[];
  return rows.map(toImportRow);
}
