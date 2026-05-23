import { existsSync, readFileSync, statSync } from 'node:fs';
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
    const stat = statSync(absolutePath);
    if (!stat.isFile()) continue;

    const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    if (keyFile.line > lines.length) continue;
    const targetLine = keyFile.line;
    const startLine = Math.max(1, targetLine - radius);
    const endLine = Math.min(lines.length, targetLine + radius);
    const snippet = lines
      .slice(startLine - 1, endLine)
      .map((line, index) => `${startLine + index}: ${line}`)
      .join('\n')
      .slice(0, maxSnippetChars);

    entries.push({
      path: keyFile.path,
      startLine,
      endLine,
      snippet,
    });
  }

  return entries;
}
