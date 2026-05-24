export interface PrDiffHunkContext {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  heading?: string;
}

export interface PrDiffWithContext {
  changedFiles: string[];
  hunkCount: number;
  hunks: PrDiffHunkContext[];
  diffCharCount: number;
}

export function buildPrDiffWithContext(
  prDiff: string,
  options: { maxHunks?: number } = {},
): PrDiffWithContext {
  const maxHunks = options.maxHunks ?? 120;
  const changedFiles: string[] = [];
  const hunks: PrDiffHunkContext[] = [];
  const seenFiles = new Set<string>();
  let currentFile: string | undefined;

  for (const line of prDiff.split('\n')) {
    const filePath = parseDiffGitNewPath(line);
    if (filePath != null) {
      currentFile = filePath;
      if (!seenFiles.has(currentFile)) {
        seenFiles.add(currentFile);
        changedFiles.push(currentFile);
      }
      continue;
    }
    if (currentFile == null || hunks.length >= maxHunks) continue;
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s?(.*)$/.exec(line);
    if (hunkMatch == null) continue;
    hunks.push({
      file: currentFile,
      oldStart: Number(hunkMatch[1]),
      oldLines: Number(hunkMatch[2] ?? 1),
      newStart: Number(hunkMatch[3]),
      newLines: Number(hunkMatch[4] ?? 1),
      ...(hunkMatch[5].trim().length > 0 ? { heading: hunkMatch[5].trim() } : {}),
    });
  }

  return {
    changedFiles,
    hunkCount: hunks.length,
    hunks,
    diffCharCount: prDiff.length,
  };
}

function parseDiffGitNewPath(line: string): string | null {
  if (!line.startsWith('diff --git ')) return null;
  const tokens = parseDiffGitTokens(line.slice('diff --git '.length));
  const newPath = tokens[1];
  if (newPath == null || !newPath.startsWith('b/')) return null;
  return newPath.slice(2);
}

function parseDiffGitTokens(input: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < input.length && tokens.length < 2) {
    while (input[index] === ' ') index += 1;
    if (index >= input.length) break;
    if (input[index] === '"') {
      const parsed = readQuotedToken(input, index + 1);
      if (parsed == null) return tokens;
      tokens.push(parsed.value);
      index = parsed.nextIndex;
    } else {
      const nextSpace = input.indexOf(' ', index);
      if (nextSpace === -1) {
        tokens.push(input.slice(index));
        break;
      }
      tokens.push(input.slice(index, nextSpace));
      index = nextSpace + 1;
    }
  }
  return tokens;
}

function readQuotedToken(
  input: string,
  startIndex: number,
): { value: string; nextIndex: number } | null {
  let value = '';
  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') return { value, nextIndex: index + 1 };
    if (char === '\\') {
      const next = input[index + 1];
      if (next == null) return null;
      value += unescapeGitPathChar(next);
      index += 1;
    } else {
      value += char;
    }
  }
  return null;
}

function unescapeGitPathChar(char: string): string {
  if (char === 't') return '\t';
  if (char === 'n') return '\n';
  if (char === 'r') return '\r';
  return char;
}
