import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import ts from 'typescript';
import { openRouteIndexDb } from './db.js';
import type { ComponentUsageRow, RouteRow } from './types.js';

export interface BuildRouteIndexOptions {
  repoRoot: string;
  dbPath?: string;
  db?: Database.Database;
}

export interface BuildRouteIndexResult {
  filesIndexed: number;
  routesIndexed: number;
  componentUsagesIndexed: number;
}

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'coverage', '.git', '.factory']);

function walkTsxFiles(absRoot: string): string[] {
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
      if (entry.isDirectory()) visit(abs);
      if (entry.isFile() && entry.name.endsWith('.tsx')) out.push(abs);
    }
  };
  visit(absRoot);
  return out;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function jsxTagName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText();
}

function jsxAttribute(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (prop): prop is ts.JsxAttribute =>
      ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name) && prop.name.text === name,
  );
}

function stringAttribute(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
  const attr = jsxAttribute(node, name);
  if (attr?.initializer == null) return undefined;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  return undefined;
}

function routeElementComponent(node: ts.JsxOpeningLikeElement): string | undefined {
  const attr = jsxAttribute(node, 'element');
  const expr = attr?.initializer;
  if (!expr || !ts.isJsxExpression(expr) || expr.expression == null) return undefined;
  if (ts.isJsxSelfClosingElement(expr.expression) || ts.isJsxElement(expr.expression)) {
    const opening = ts.isJsxElement(expr.expression)
      ? expr.expression.openingElement
      : expr.expression;
    return jsxTagName(opening.tagName);
  }
  return undefined;
}

function extract(
  absPath: string,
  relPath: string,
): {
  routes: RouteRow[];
  usages: ComponentUsageRow[];
} {
  const sf = ts.createSourceFile(
    absPath,
    fs.readFileSync(absPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routes: RouteRow[] = [];
  const usages: ComponentUsageRow[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = jsxTagName(node.tagName);
      if (/^[A-Z]/.test(tag) && tag !== 'Route') {
        usages.push({ component: tag, filePath: relPath, line: lineOf(sf, node) });
      }
      if (tag === 'Route') {
        const pathPattern = stringAttribute(node, 'path');
        if (pathPattern != null) {
          const component = routeElementComponent(node);
          routes.push({
            pathPattern,
            filePath: relPath,
            line: lineOf(sf, node),
            ...(component != null ? { component } : {}),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { routes, usages };
}

export function buildRouteIndex(opts: BuildRouteIndexOptions): BuildRouteIndexResult {
  const db = opts.db ?? openRouteIndexDb(opts.dbPath);
  const ownsDb = opts.db == null;
  const webSrc = path.join(opts.repoRoot, 'apps/web/src');
  const absFiles = fs.existsSync(webSrc) ? walkTsxFiles(webSrc).sort() : [];
  const now = new Date().toISOString();

  const insertFile = db.prepare(
    'INSERT OR REPLACE INTO files (path, mtime_ms, last_indexed_at) VALUES (?, ?, ?)',
  );
  const insertRoute = db.prepare(
    'INSERT INTO routes (path_pattern, file_path, line, component) VALUES (?, ?, ?, ?)',
  );
  const insertUsage = db.prepare(
    'INSERT INTO component_usages (component, file_path, line) VALUES (?, ?, ?)',
  );

  let routesIndexed = 0;
  let componentUsagesIndexed = 0;
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM routes').run();
    db.prepare('DELETE FROM component_usages').run();
    db.prepare('DELETE FROM files').run();
    for (const abs of absFiles) {
      const rel = path.relative(opts.repoRoot, abs).split(path.sep).join('/');
      const { routes, usages } = extract(abs, rel);
      insertFile.run(rel, Math.floor(fs.statSync(abs).mtimeMs), now);
      for (const route of routes) {
        insertRoute.run(route.pathPattern, route.filePath, route.line, route.component ?? null);
        routesIndexed++;
      }
      for (const usage of usages) {
        insertUsage.run(usage.component, usage.filePath, usage.line);
        componentUsagesIndexed++;
      }
    }
  });
  txn();
  if (ownsDb) db.close();
  return { filesIndexed: absFiles.length, routesIndexed, componentUsagesIndexed };
}
