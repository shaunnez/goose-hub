import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import ts from 'typescript';
import { openIndexDb } from './db.js';
import type { ImportRow, SymbolKind, SymbolRow } from './types.js';

export interface BuildOptions {
  /** Repo root. All file paths in the index are stored relative to this. */
  repoRoot: string;
  /** Override the DB path. Ignored if `db` is provided. */
  dbPath?: string;
  /** Top-level directories under repoRoot to walk. Defaults to apps/core/slices/skills. */
  includeDirs?: string[];
  /** Test seam: pass an in-memory or pre-opened DB. Caller closes it. */
  db?: Database.Database;
}

export interface BuildResult {
  filesIndexed: number;
  symbolsIndexed: number;
  importsIndexed: number;
}

const DEFAULT_INCLUDE_DIRS = ['apps', 'core', 'slices', 'skills'];
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.worktrees',
  '.factory',
  '.git',
  '.claude',
]);

function walkTsFiles(absRoot: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(abs);
      }
    }
  };
  visit(absRoot);
  return out;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

interface FileExtract {
  symbols: Array<Omit<SymbolRow, 'filePath'>>;
  imports: Array<Omit<ImportRow, 'filePath'>>;
}

export function extractFromSource(absPath: string, content: string): FileExtract {
  const sf = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true);
  const symbols: FileExtract['symbols'] = [];
  const imports: FileExtract['imports'] = [];

  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier;
      if (!ts.isStringLiteral(spec)) continue;
      const sourceModule = spec.text;
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) {
        imports.push({ sourceModule, importedName: clause.name.text });
      }
      const bindings = clause.namedBindings;
      if (bindings) {
        if (ts.isNamespaceImport(bindings)) {
          imports.push({ sourceModule, importedName: bindings.name.text });
        } else if (ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            imports.push({ sourceModule, importedName: el.name.text });
          }
        }
      }
      continue;
    }

    const exported = hasExportModifier(stmt);

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      symbols.push({ name: stmt.name.text, kind: 'function', line: lineOf(stmt), exported });
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      symbols.push({ name: stmt.name.text, kind: 'class', line: lineOf(stmt), exported });
    } else if (ts.isInterfaceDeclaration(stmt)) {
      symbols.push({ name: stmt.name.text, kind: 'interface', line: lineOf(stmt), exported });
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      symbols.push({ name: stmt.name.text, kind: 'type', line: lineOf(stmt), exported });
    } else if (ts.isEnumDeclaration(stmt)) {
      symbols.push({ name: stmt.name.text, kind: 'enum', line: lineOf(stmt), exported });
    } else if (ts.isVariableStatement(stmt)) {
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const kind: SymbolKind = isConst ? 'const' : 'variable';
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          symbols.push({ name: decl.name.text, kind, line: lineOf(decl), exported });
        }
      }
    }
  }

  return { symbols, imports };
}

/**
 * Build (or rebuild) the symbol index against the repo at `opts.repoRoot`.
 *
 * Rebuild strategy: full rewrite. Files no longer on disk are removed.
 * Files still present are deleted-and-reinserted. Simpler and more correct
 * than diff-tracking, and fast enough on the current repo size (~sub-second).
 */
export function buildIndex(opts: BuildOptions): BuildResult {
  const db = opts.db ?? openIndexDb(opts.dbPath);
  const ownsDb = opts.db === undefined;
  const includeDirs = opts.includeDirs ?? DEFAULT_INCLUDE_DIRS;
  const now = new Date().toISOString();

  const absFiles: string[] = [];
  for (const dir of includeDirs) {
    const abs = path.join(opts.repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    absFiles.push(...walkTsFiles(abs));
  }
  const relFiles = absFiles.map((f) => path.relative(opts.repoRoot, f).split(path.sep).join('/'));

  const insertFile = db.prepare(
    'INSERT OR REPLACE INTO files (path, last_indexed_at) VALUES (?, ?)',
  );
  const deleteSymbolsForFile = db.prepare('DELETE FROM symbols WHERE file_path = ?');
  const deleteImportsForFile = db.prepare('DELETE FROM imports WHERE file_path = ?');
  const insertSymbol = db.prepare(
    'INSERT INTO symbols (file_path, name, kind, line, exported) VALUES (?, ?, ?, ?, ?)',
  );
  const insertImport = db.prepare(
    'INSERT INTO imports (file_path, source_module, imported_name) VALUES (?, ?, ?)',
  );

  // Files that disappeared since last build: present in files table but not on disk.
  const knownFiles = (db.prepare('SELECT path FROM files').all() as Array<{ path: string }>).map(
    (r) => r.path,
  );
  const seen = new Set(relFiles);
  const removed = knownFiles.filter((p) => !seen.has(p));

  let symbolsIndexed = 0;
  let importsIndexed = 0;

  const txn = db.transaction(() => {
    for (const gone of removed) {
      deleteSymbolsForFile.run(gone);
      deleteImportsForFile.run(gone);
      db.prepare('DELETE FROM files WHERE path = ?').run(gone);
    }
    for (let i = 0; i < absFiles.length; i++) {
      const abs = absFiles[i];
      const rel = relFiles[i];
      const content = fs.readFileSync(abs, 'utf8');
      const { symbols, imports } = extractFromSource(abs, content);
      deleteSymbolsForFile.run(rel);
      deleteImportsForFile.run(rel);
      insertFile.run(rel, now);
      for (const s of symbols) {
        insertSymbol.run(rel, s.name, s.kind, s.line, s.exported ? 1 : 0);
        symbolsIndexed++;
      }
      for (const im of imports) {
        insertImport.run(rel, im.sourceModule, im.importedName);
        importsIndexed++;
      }
    }
  });
  txn();

  if (ownsDb) db.close();

  return {
    filesIndexed: absFiles.length,
    symbolsIndexed,
    importsIndexed,
  };
}
