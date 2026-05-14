export interface ParsedLine {
  kind: 'add' | 'del' | 'ctx';
  content: string;
  leftLine: number | null;
  rightLine: number | null;
}

export interface ParsedHunk {
  header: string;
  lines: ParsedLine[];
}

export interface ParsedFile {
  path: string;
  status: 'new' | 'mod' | 'del';
  adds: number;
  dels: number;
  hunks: ParsedHunk[];
}

const GENERATED_DIFF_PATH_PREFIXES = ['.pnpm-store/', 'node_modules/', '.claude/'] as const;

function isGeneratedDiffPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return GENERATED_DIFF_PATH_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

/**
 * Parses a unified diff string into a structured per-file list with hunks
 * carrying line-number metadata for left/right gutters.
 */
export function parseDiff(raw: string): ParsedFile[] {
  const lines = raw.split('\n');
  const files: ParsedFile[] = [];
  let cur: ParsedFile | null = null;
  let curHunk: ParsedHunk | null = null;
  let leftLine = 0;
  let rightLine = 0;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(cur);
      const m = line.match(/^diff --git a\/.+ b\/(.+)$/);
      const path = m ? m[1] : line.slice(11);
      cur = isGeneratedDiffPath(path) ? null : { path, status: 'mod', adds: 0, dels: 0, hunks: [] };
      curHunk = null;
      continue;
    }
    if (cur == null) continue;
    if (line.startsWith('new file mode')) {
      cur.status = 'new';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      cur.status = 'del';
      continue;
    }
    if (
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('index ') ||
      line.startsWith('Binary ')
    )
      continue;

    if (line.startsWith('@@ ')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      leftLine = m ? Number.parseInt(m[1], 10) : 0;
      rightLine = m ? Number.parseInt(m[2], 10) : 0;
      curHunk = { header: line, lines: [] };
      cur.hunks.push(curHunk);
      continue;
    }

    if (curHunk == null) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      curHunk.lines.push({
        kind: 'add',
        content: line.slice(1),
        leftLine: null,
        rightLine: rightLine++,
      });
      cur.adds++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      curHunk.lines.push({
        kind: 'del',
        content: line.slice(1),
        leftLine: leftLine++,
        rightLine: null,
      });
      cur.dels++;
    } else if (line.startsWith(' ') || line === '') {
      curHunk.lines.push({
        kind: 'ctx',
        content: line.slice(1),
        leftLine: leftLine++,
        rightLine: rightLine++,
      });
    }
  }

  if (cur) files.push(cur);
  return files;
}
