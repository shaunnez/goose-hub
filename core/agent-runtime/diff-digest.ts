import type { ArtifactRef } from '../agent-artifacts/types.js';

export type DiffFileDigest = {
  path: string;
  hunkCount: number;
  additions: number;
  deletions: number;
};

export type DiffDigest = {
  changedFiles: DiffFileDigest[];
  hunkCount: number;
  additions: number;
  deletions: number;
  roughChangeSize: 'empty' | 'small' | 'medium' | 'large';
  testFilesTouched: string[];
  riskyAreas: string[];
  artifactKey?: string;
};

function isTestFile(path: string): boolean {
  return /(^|\/)(__tests__|test|tests)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function classifyRiskyArea(path: string): string | null {
  if (/(^|\/)(auth|session|crypto|secret|secrets)(\/|\.|-|_)/i.test(path)) {
    return 'sensitive-auth-secret-surface';
  }
  if (path.startsWith('core/db/') || path.includes('/migrations/')) return 'database-schema';
  if (path.startsWith('core/event-stream/') || path.includes('/events/')) return 'event-stream';
  if (path.startsWith('core/agent-runtime/') || path.startsWith('slices/')) {
    return 'agent-workflow-runtime';
  }
  if (path.startsWith('hooks/') || path.includes('/hooks/')) return 'hook-surface';
  return null;
}

function roughSize(
  additions: number,
  deletions: number,
  hunkCount: number,
): DiffDigest['roughChangeSize'] {
  const changedLines = additions + deletions;
  if (changedLines === 0 && hunkCount === 0) return 'empty';
  if (changedLines <= 60 && hunkCount <= 6) return 'small';
  if (changedLines <= 400 && hunkCount <= 30) return 'medium';
  return 'large';
}

export function buildDiffDigest(prDiff: string, artifactRef?: ArtifactRef): DiffDigest {
  const files = new Map<string, DiffFileDigest>();
  let current: DiffFileDigest | null = null;

  for (const line of prDiff.split('\n')) {
    const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (fileMatch != null) {
      current = { path: fileMatch[2], hunkCount: 0, additions: 0, deletions: 0 };
      files.set(current.path, current);
      continue;
    }
    if (current == null) continue;
    if (line.startsWith('@@')) current.hunkCount += 1;
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }

  const changedFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const additions = changedFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0);
  const hunkCount = changedFiles.reduce((sum, file) => sum + file.hunkCount, 0);
  const riskyAreas = [
    ...new Set(changedFiles.flatMap((file) => classifyRiskyArea(file.path) ?? [])),
  ].sort();

  return {
    changedFiles,
    hunkCount,
    additions,
    deletions,
    roughChangeSize: roughSize(additions, deletions, hunkCount),
    testFilesTouched: changedFiles
      .map((file) => file.path)
      .filter(isTestFile)
      .sort(),
    riskyAreas,
    ...(artifactRef != null ? { artifactKey: artifactRef.artifactKey } : {}),
  };
}

export function formatDiffDigestSummary(digest: DiffDigest): string {
  const fileText =
    digest.changedFiles.length === 0
      ? 'no changed files detected'
      : `${digest.changedFiles.length} changed files: ${digest.changedFiles
          .slice(0, 12)
          .map((file) => file.path)
          .join(', ')}${digest.changedFiles.length > 12 ? ', ...' : ''}`;
  return `${fileText}; ${digest.hunkCount} hunks; +${digest.additions}/-${digest.deletions}; ${digest.roughChangeSize}`;
}
