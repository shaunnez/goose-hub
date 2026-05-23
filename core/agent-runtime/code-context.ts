import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export interface CodeContextKeyFile {
  path: string;
  line?: number;
  reason?: string;
}

export interface CodeContextEntry {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export function buildCodeContextBundle(input: {
  worktreePath: string;
  keyFiles: CodeContextKeyFile[];
  radius?: number;
  maxEntries?: number;
  maxSnippetChars?: number;
}): CodeContextEntry[] {
  const radius = input.radius ?? 30;
  const maxEntries = input.maxEntries ?? 8;
  const maxSnippetChars = input.maxSnippetChars ?? 12_000;
  const root = resolve(input.worktreePath);
  const realRoot = safeRealpath(root) ?? root;
  const entries: CodeContextEntry[] = [];
  const seen = new Set<string>();

  for (const keyFile of input.keyFiles) {
    if (entries.length >= maxEntries) break;
    if (
      typeof keyFile.path !== 'string' ||
      keyFile.path.length === 0 ||
      isAbsolute(keyFile.path) ||
      !Number.isInteger(keyFile.line) ||
      keyFile.line == null ||
      keyFile.line < 1
    ) {
      continue;
    }
    const absolutePath = resolve(root, keyFile.path);
    const relativePath = relative(root, absolutePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) continue;
    const cacheKey = `${keyFile.path}:${keyFile.line}`;
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    if (!existsSync(absolutePath)) continue;
    const realPath = safeRealpath(absolutePath);
    if (realPath == null || !isWithinRoot(realRoot, realPath)) continue;

    let stat: ReturnType<typeof statSync>;
    let contents: string;
    try {
      stat = statSync(realPath);
      if (!stat.isFile()) continue;
      contents = readFileSync(realPath, 'utf8');
    } catch {
      continue;
    }

    const lines = contents.split(/\r?\n/);
    if (keyFile.line > lines.length) continue;
    const targetLine = keyFile.line;
    const startLine = Math.max(1, targetLine - radius);
    const endLine = Math.min(lines.length, targetLine + radius);
    const snippet = buildSnippet({ lines, startLine, endLine, targetLine, maxSnippetChars });

    entries.push({
      path: keyFile.path,
      startLine: snippet.startLine,
      endLine: snippet.endLine,
      snippet: snippet.text,
    });
  }

  return entries;
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function buildSnippet(input: {
  lines: string[];
  startLine: number;
  endLine: number;
  targetLine: number;
  maxSnippetChars: number;
}): { startLine: number; endLine: number; text: string } {
  let startLine = input.startLine;
  let endLine = input.endLine;
  let text = renderSnippet(input.lines, startLine, endLine);

  while (text.length > input.maxSnippetChars && startLine < input.targetLine) {
    startLine += 1;
    text = renderSnippet(input.lines, startLine, endLine);
  }
  while (text.length > input.maxSnippetChars && endLine > input.targetLine) {
    endLine -= 1;
    text = renderSnippet(input.lines, startLine, endLine);
  }
  if (text.length > input.maxSnippetChars) {
    startLine = input.targetLine;
    endLine = input.targetLine;
    text = renderSnippet(input.lines, startLine, endLine).slice(0, input.maxSnippetChars);
  }

  return { startLine, endLine, text };
}

function renderSnippet(lines: string[], startLine: number, endLine: number): string {
  return lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');
}
