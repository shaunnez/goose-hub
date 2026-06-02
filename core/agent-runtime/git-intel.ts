import { spawnSync } from 'node:child_process';
import { minimalEnv, runCommand } from '../tool-layer/mcp/command-policy.js';
import type { RepoRelativePath } from '../tool-layer/path-contract.js';
import { GIT_ENV } from '../workspaces/git-env.js';

export interface RecentChangedFile {
  path: RepoRelativePath;
  lastTouched: string;
  lastCommitSha: string;
}

function gitSinceDays(days: number): string {
  return `${days} days ago`;
}

function normalizeGitSince(since: string): string {
  const shorthand = since.match(/^(\d+)d$/);
  return shorthand == null ? since : gitSinceDays(Number(shorthand[1]));
}

/**
 * Returns files touched anywhere in the repo within the last `sinceDays`
 * days, without requiring a candidate-file filter. Used as a grounding
 * signal — recently-changed files are likely related to a fresh bug
 * report — when no other anchor is available.
 */
export async function gitRecentlyTouched(input: {
  worktreePath: string;
  sinceDays?: number;
  limit?: number;
}): Promise<RecentChangedFile[]> {
  const result = await runCommand({
    command: 'git',
    args: [
      'log',
      `--since=${gitSinceDays(input.sinceDays ?? 14)}`,
      '--name-only',
      '--pretty=format:%H%x09%cI',
    ],
    cwd: input.worktreePath,
    timeoutMs: 10_000,
    env: minimalEnv(),
  });
  if (result.status !== 'ok') return [];
  const out: RecentChangedFile[] = [];
  const seen = new Set<string>();
  let currentSha = '';
  let currentIso = '';
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const [sha, iso] = line.split('\t');
    if (/^[0-9a-f]{7,40}$/i.test(sha ?? '') && iso != null) {
      currentSha = sha;
      currentIso = iso;
      continue;
    }
    if (seen.has(line) || currentSha.length === 0) continue;
    seen.add(line);
    out.push({
      path: { path: line, root: 'worktree' },
      lastTouched: currentIso,
      lastCommitSha: currentSha,
    });
    if (out.length >= (input.limit ?? 15)) break;
  }
  return out;
}

/**
 * Returns repo-relative paths changed in the current worktree relative to
 * `baseBranch...HEAD`. Used by fix-feedback to remind the dev agent which
 * files the prior pass already touched, so the repair stays anchored to the
 * existing surface rather than re-discovering it.
 *
 * Empty array on any git failure — this is observability, not authority.
 */
export function getChangedFilesSince(worktreePath: string, baseBranch = 'main'): string[] {
  const result = spawnSync('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
    cwd: worktreePath,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    env: GIT_ENV,
  });
  if (result.error != null || result.status !== 0) return [];
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function gitRecentChanges(input: {
  worktreePath: string;
  candidateFiles: RepoRelativePath[];
  since?: string;
  limit?: number;
}): Promise<RecentChangedFile[]> {
  const candidateSet = new Set(input.candidateFiles.map((file) => file.path));
  if (candidateSet.size === 0) return [];

  const result = await runCommand({
    command: 'git',
    args: [
      'log',
      `--since=${normalizeGitSince(input.since ?? gitSinceDays(14))}`,
      '--name-only',
      '--pretty=format:%H%x09%cI',
    ],
    cwd: input.worktreePath,
    timeoutMs: 10_000,
    env: minimalEnv(),
  });
  if (result.status !== 'ok') return [];

  const out: RecentChangedFile[] = [];
  const seen = new Set<string>();
  let currentSha = '';
  let currentIso = '';
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const [sha, iso] = line.split('\t');
    if (/^[0-9a-f]{7,40}$/i.test(sha ?? '') && iso != null) {
      currentSha = sha;
      currentIso = iso;
      continue;
    }
    if (!candidateSet.has(line) || seen.has(line) || currentSha.length === 0) continue;
    seen.add(line);
    out.push({
      path: { path: line, root: 'worktree' },
      lastTouched: currentIso,
      lastCommitSha: currentSha,
    });
    if (out.length >= (input.limit ?? 15)) break;
  }
  return out;
}
