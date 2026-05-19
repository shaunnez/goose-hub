import type { z } from 'zod';
import { emitToolCall } from '../audit.js';
import { type CommandResult, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import type {
  GetChangedFilesInput,
  GetDiffInput,
  GetHeadShaInput,
  GetMergeBaseInput,
  GetStatusInput,
} from '../schemas.js';

const GIT_TIMEOUT_MS = 30 * 1000;
const DIFF_STDOUT_LIMIT_BYTES = 512 * 1024;

export class GitCommandError extends Error {
  readonly kind = 'GitCommandError' as const;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(exitCode: number | null, stderr: string, message: string) {
    super(message);
    this.name = 'GitCommandError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'unmerged'
  | 'unknown';

export interface GitStatusEntry {
  path: string;
  status: GitChangeStatus;
  staged: boolean;
}

export interface GetStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
  clean: boolean;
}

export interface GetChangedFilesResult {
  files: string[];
}

export interface GetDiffResult {
  diff: string;
  truncated: boolean;
  staged: boolean;
}

export interface GetHeadShaResult {
  sha: string;
}

export interface GetMergeBaseResult {
  base: string | null;
  ref: string;
}

async function git(
  ctx: FactoryContext,
  args: ReadonlyArray<string>,
  stdoutLimitBytes?: number,
): Promise<CommandResult> {
  return runCommand({
    command: 'git',
    args,
    cwd: ctx.workspaceRoot,
    timeoutMs: GIT_TIMEOUT_MS,
    stdoutLimitBytes,
    env: minimalEnv(),
  });
}

function ensureOk(tool: string, result: CommandResult): CommandResult {
  if (result.status !== 'ok') {
    throw new GitCommandError(
      result.exitCode,
      result.stderr,
      `${tool}: git exited ${result.status} (code ${result.exitCode ?? 'null'}): ${result.stderr.trim()}`,
    );
  }
  return result;
}

function mapPorcelainCode(code: string): GitChangeStatus {
  if (code === '??') return 'untracked';
  if (code === '!!') return 'ignored';
  if (code.includes('U')) return 'unmerged';
  const indicator = code[1] !== ' ' ? code[1] : code[0];
  switch (indicator) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'unknown';
  }
}

/**
 * Returns the working-tree status alongside branch + ahead/behind counts.
 * Reads `--porcelain=v2 --branch` so the output is stable across git
 * versions and locale settings.
 */
export async function getStatusTool(
  ctx: FactoryContext,
  _input: z.infer<typeof GetStatusInput> = {},
): Promise<GetStatusResult> {
  const result = ensureOk('get_status', await git(ctx, ['status', '--porcelain=v2', '--branch']));

  let branch = '';
  let ahead = 0;
  let behind = 0;
  const entries: GitStatusEntry[] = [];

  for (const line of result.stdout.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number.parseInt(match[1], 10);
        behind = Number.parseInt(match[2], 10);
      }
      continue;
    }
    if (line.startsWith('#')) continue;

    if (line.startsWith('? ')) {
      entries.push({ path: line.slice(2).trim(), status: 'untracked', staged: false });
      continue;
    }
    if (line.startsWith('! ')) {
      entries.push({ path: line.slice(2).trim(), status: 'ignored', staged: false });
      continue;
    }
    // Tracked entries: `1 <xy> ...` (ordinary) or `2 <xy> ...` (renamed/copied).
    const parts = line.split(' ');
    if (parts.length < 9) continue;
    const xy = parts[1];
    const isRename = parts[0] === '2';
    const path = isRename ? parts.slice(9).join(' ').split('\t')[0] : parts.slice(8).join(' ');
    const staged = xy[0] !== '.' && xy[0] !== ' ';
    entries.push({ path, status: mapPorcelainCode(xy), staged });
  }

  const out: GetStatusResult = {
    branch,
    ahead,
    behind,
    entries,
    clean: entries.length === 0,
  };

  emitToolCall(ctx, {
    tool: 'get_status',
    input: {},
    status: 'ok',
    durationMs: result.durationMs,
  });
  return out;
}

/**
 * Plain list of changed-or-untracked paths. Equivalent to running
 * `git status --porcelain` and stripping the indicator column, but pulls
 * the structured `entries` from `get_status` so the two stay aligned.
 */
export async function getChangedFilesTool(
  ctx: FactoryContext,
  _input: z.infer<typeof GetChangedFilesInput> = {},
): Promise<GetChangedFilesResult> {
  const status = await getStatusTool(ctx, {});
  const files = Array.from(new Set(status.entries.map((e) => e.path)));

  emitToolCall(ctx, { tool: 'get_changed_files', input: {}, status: 'ok' });
  return { files };
}

/**
 * Returns the diff for the working tree (or the index when `staged: true`).
 * Capped at 512 KB; truncated diffs are flagged in the result rather than
 * silently chopped.
 */
export async function getDiffTool(
  ctx: FactoryContext,
  input: z.infer<typeof GetDiffInput>,
): Promise<GetDiffResult> {
  const staged = input.staged === true;
  const args = ['diff', '--no-color'];
  if (staged) args.push('--cached');

  const result = ensureOk('get_diff', await git(ctx, args, DIFF_STDOUT_LIMIT_BYTES));

  emitToolCall(ctx, {
    tool: 'get_diff',
    input: { staged },
    status: 'ok',
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return { diff: result.stdout, truncated: result.truncated, staged };
}

export async function getHeadShaTool(
  ctx: FactoryContext,
  _input: z.infer<typeof GetHeadShaInput> = {},
): Promise<GetHeadShaResult> {
  const result = ensureOk('get_head_sha', await git(ctx, ['rev-parse', 'HEAD']));
  const sha = result.stdout.trim();
  emitToolCall(ctx, {
    tool: 'get_head_sha',
    input: {},
    status: 'ok',
    durationMs: result.durationMs,
  });
  return { sha };
}

/**
 * Returns the merge base between HEAD and `ref` (defaults to `origin/main`).
 * A `null` base means git found no common ancestor — typically the ref
 * doesn't exist or the histories are unrelated.
 */
export async function getMergeBaseTool(
  ctx: FactoryContext,
  input: z.infer<typeof GetMergeBaseInput>,
): Promise<GetMergeBaseResult> {
  const ref = input.ref ?? 'origin/main';
  const result = await git(ctx, ['merge-base', 'HEAD', ref]);

  // git merge-base exits 1 when there is no common ancestor, and 128 when
  // the ref doesn't resolve. Both are "no base" from the agent's point of
  // view — only timeouts or spawn errors are unrecoverable.
  let base: string | null = null;
  if (result.status === 'ok') {
    base = result.stdout.trim() || null;
  } else if (result.status === 'timed_out') {
    throw new GitCommandError(
      result.exitCode,
      result.stderr,
      `get_merge_base timed out after ${result.durationMs} ms`,
    );
  } else if (result.exitCode == null) {
    throw new GitCommandError(
      result.exitCode,
      result.stderr,
      `get_merge_base: failed to spawn git: ${result.stderr.trim()}`,
    );
  } else {
    base = null;
  }

  emitToolCall(ctx, {
    tool: 'get_merge_base',
    input: { ref },
    status: 'ok',
    durationMs: result.durationMs,
  });
  return { base, ref };
}
