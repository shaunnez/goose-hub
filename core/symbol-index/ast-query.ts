import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { walkTsFiles } from './builder.js';

export interface SymbolHit {
  path: string;
  line: number;
  symbol: string;
}

export interface AstQueryOptions {
  worktreePath: string;
}

export interface LiteralArgFilter {
  argIndex: number;
  literal: string;
}

export interface JsxPropFilter {
  name: string;
  value?: string;
}

function sourceFile(absPath: string): ts.SourceFile {
  const content = fs.readFileSync(absPath, 'utf8');
  const scriptKind = absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function repoPath(worktreePath: string, absPath: string): string {
  return path.relative(worktreePath, absPath).split(path.sep).join('/');
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function literalValue(node: ts.Expression | undefined): string | undefined {
  if (node == null) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  return undefined;
}

function tsFiles(worktreePath: string): string[] {
  return walkTsFiles(worktreePath).sort((a, b) => a.localeCompare(b));
}

export function findCallsOf(
  symbol: string,
  options: AstQueryOptions & { withLiteralArg?: LiteralArgFilter },
): SymbolHit[] {
  const hits: SymbolHit[] = [];
  for (const absPath of tsFiles(options.worktreePath)) {
    let sf: ts.SourceFile;
    try {
      sf = sourceFile(absPath);
    } catch {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && expressionName(node.expression) === symbol) {
        const filter = options.withLiteralArg;
        const matchesFilter =
          filter == null || literalValue(node.arguments[filter.argIndex]) === filter.literal;
        if (matchesFilter) {
          hits.push({
            path: repoPath(options.worktreePath, absPath),
            line: lineOf(sf, node),
            symbol,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}

export function findImportersImporting(
  module: string,
  symbol: string,
  options: AstQueryOptions,
): SymbolHit[] {
  const hits: SymbolHit[] = [];
  for (const absPath of tsFiles(options.worktreePath)) {
    let sf: ts.SourceFile;
    try {
      sf = sourceFile(absPath);
    } catch {
      continue;
    }
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      if (stmt.moduleSpecifier.text !== module) continue;
      const bindings = stmt.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName === symbol) {
          hits.push({
            path: repoPath(options.worktreePath, absPath),
            line: lineOf(sf, element),
            symbol,
          });
        }
      }
    }
  }
  return hits;
}

function jsxTagName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText();
}

function jsxAttributeValue(attribute: ts.JsxAttribute): string | undefined {
  const initializer = attribute.initializer;
  if (initializer == null) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer)) return literalValue(initializer.expression);
  return undefined;
}

function hasProp(node: ts.JsxOpeningLikeElement, filter: JsxPropFilter): boolean {
  return node.attributes.properties.some((prop) => {
    if (!ts.isJsxAttribute(prop) || !ts.isIdentifier(prop.name) || prop.name.text !== filter.name) {
      return false;
    }
    if (filter.value == null) return true;
    return jsxAttributeValue(prop) === filter.value;
  });
}

export function findJsxUsages(
  component: string,
  options: AstQueryOptions & { withProp?: JsxPropFilter },
): SymbolHit[] {
  const hits: SymbolHit[] = [];
  for (const absPath of tsFiles(options.worktreePath)) {
    let sf: ts.SourceFile;
    try {
      sf = sourceFile(absPath);
    } catch {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        jsxTagName(node.tagName) === component &&
        (options.withProp == null || hasProp(node, options.withProp))
      ) {
        hits.push({
          path: repoPath(options.worktreePath, absPath),
          line: lineOf(sf, node),
          symbol: component,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}
