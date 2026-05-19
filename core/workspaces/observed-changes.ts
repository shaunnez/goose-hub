import { execFileSync } from 'node:child_process';
import { GIT_ENV } from './git-env.js';
import {
  type RepoRelativePathNormalizationSource,
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from './path-normalization.js';

export type ObservedChangedFileStatus =
  | 'added'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'untracked'
  | 'changed';

export type ObservedChangedFileSource = 'git-diff' | 'git-diff-cached' | 'git-status';

export interface ObservedChangedFile {
  path: string;
  rawPath: string;
  status: ObservedChangedFileStatus;
  sources: ObservedChangedFileSource[];
  normalizationSource: RepoRelativePathNormalizationSource;
}

export interface ObservedChangedFilesPacket {
  count: number;
  paths: string[];
  files: ObservedChangedFile[];
  gitAvailable: boolean;
}

function runGit(
  worktreePath: string,
  args: string[],
): { ok: true; stdout: string } | { ok: false } {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', args, {
        cwd: worktreePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: GIT_ENV,
      }),
    };
  } catch {
    return { ok: false };
  }
}

function lines(stdout: string, options: { preserveLeadingWhitespace?: boolean } = {}): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => (options.preserveLeadingWhitespace === true ? line.trimEnd() : line.trim()))
    .filter((line) => line.length > 0);
}

function statusKind(code: string): ObservedChangedFileStatus {
  if (code === '??') return 'untracked';
  if (code.includes('R')) return 'renamed';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  if (code.includes('M')) return 'modified';
  return 'changed';
}

function pathFromPorcelainLine(line: string): { path: string; status: ObservedChangedFileStatus } {
  const code = line.slice(0, 2);
  const pathPart = line.slice(3).trim();
  const renamedPath = pathPart.includes(' -> ')
    ? (pathPart.split(' -> ').at(-1) ?? pathPart)
    : pathPart;
  return { path: renamedPath, status: statusKind(code) };
}

function mergeStatus(
  existing: ObservedChangedFileStatus,
  next: ObservedChangedFileStatus,
): ObservedChangedFileStatus {
  if (next === 'deleted' || existing === 'deleted') return 'deleted';
  if (next === 'renamed' || existing === 'renamed') return 'renamed';
  if (next === 'untracked' || existing === 'untracked') return 'untracked';
  if (next === 'added' || existing === 'added') return 'added';
  if (next === 'modified' || existing === 'modified') return 'modified';
  return next;
}

export function deriveObservedChangedFiles(worktreePath: string): ObservedChangedFilesPacket {
  const packageRoots = discoverPackageRoots(worktreePath);
  const files = new Map<string, ObservedChangedFile>();
  const gitResults = [
    runGit(worktreePath, ['diff', '--name-only']),
    runGit(worktreePath, ['diff', '--cached', '--name-only']),
    runGit(worktreePath, ['status', '--porcelain', '--untracked-files=all']),
  ] as const;
  const gitAvailable = gitResults.some((result) => result.ok);

  const addPath = (
    rawPath: string,
    status: ObservedChangedFileStatus,
    source: ObservedChangedFileSource,
  ): void => {
    const normalized = normalizeRepoRelativePath({ rawPath, worktreePath, packageRoots });
    const existing = files.get(normalized.path);
    if (existing != null) {
      existing.status = mergeStatus(existing.status, status);
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    files.set(normalized.path, {
      path: normalized.path,
      rawPath,
      status,
      sources: [source],
      normalizationSource: normalized.source,
    });
  };

  const [diff, cachedDiff, status] = gitResults;
  if (diff.ok) {
    for (const path of lines(diff.stdout)) addPath(path, 'modified', 'git-diff');
  }
  if (cachedDiff.ok) {
    for (const path of lines(cachedDiff.stdout)) addPath(path, 'changed', 'git-diff-cached');
  }
  if (status.ok) {
    for (const line of lines(status.stdout, { preserveLeadingWhitespace: true })) {
      const parsed = pathFromPorcelainLine(line);
      addPath(parsed.path, parsed.status, 'git-status');
    }
  }

  const observedFiles = [...files.values()];
  return {
    count: observedFiles.length,
    paths: observedFiles.map((file) => file.path),
    files: observedFiles,
    gitAvailable,
  };
}
