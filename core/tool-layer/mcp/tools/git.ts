import type { z } from 'zod';
import type { RepoRelativePath } from '../../path-contract.js';
import { canonicalizeFactoryToolPath } from '../../path-contract.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { type CommandResult, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  GetBlameInput,
  GetChangedFilesInput,
  GetDiffInput,
  GetHeadShaInput,
  GetLogInput,
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
  path: RepoRelativePath;
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
  files: RepoRelativePath[];
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

function gitPathToCanonical(rawPath: string, workspaceRoot: string): RepoRelativePath {
  const result = canonicalizeFactoryToolPath({ rawPath, worktreePath: workspaceRoot });
  return result.ok ? result.path : { path: rawPath, root: 'worktree' };
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
      entries.push({
        path: gitPathToCanonical(line.slice(2).trim(), ctx.workspaceRoot),
        status: 'untracked',
        staged: false,
      });
      continue;
    }
    if (line.startsWith('! ')) {
      entries.push({
        path: gitPathToCanonical(line.slice(2).trim(), ctx.workspaceRoot),
        status: 'ignored',
        staged: false,
      });
      continue;
    }
    // Tracked entries: `1 <xy> ...` (ordinary) or `2 <xy> ...` (renamed/copied).
    const parts = line.split(' ');
    if (parts.length < 9) continue;
    const xy = parts[1];
    const isRename = parts[0] === '2';
    const rawPath = isRename ? parts.slice(9).join(' ').split('\t')[0] : parts.slice(8).join(' ');
    const staged = xy[0] !== '.' && xy[0] !== ' ';
    entries.push({
      path: gitPathToCanonical(rawPath, ctx.workspaceRoot),
      status: mapPorcelainCode(xy),
      staged,
    });
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
  const seen = new Set<string>();
  const files: RepoRelativePath[] = [];
  for (const entry of status.entries) {
    if (!seen.has(entry.path.path)) {
      seen.add(entry.path.path);
      files.push(entry.path);
    }
  }

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

export interface GitLogEntry {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
}

export interface GetLogResult {
  commits: GitLogEntry[];
  truncated: boolean;
}

const LOG_DEFAULT_LIMIT = 50;
const LOG_MAX_LIMIT = 500;
const LOG_FIELD_SEP = '\x1f';
const LOG_RECORD_SEP = '\x1e';

function handleBlocked(
  ctx: FactoryContext,
  tool: string,
  err: PathPolicyViolation,
  input: Record<string, unknown>,
): never {
  emitBlockedToolCall(ctx, {
    tool,
    input,
    blocked: true,
    reason: err.code,
    message: err.message,
  });
  throw err;
}

/**
 * Reads commit history. Used by code-quality-audit for Cat 7 (Gall's Law
 * evolution analysis) — when did each surface stabilize, who touched it,
 * how big were the deltas. Output uses ASCII control-byte separators so
 * the format is unambiguous regardless of locale or commit message
 * content.
 */
export async function getLogTool(
  ctx: FactoryContext,
  input: z.infer<typeof GetLogInput>,
): Promise<GetLogResult> {
  const limit = Math.min(input.limit ?? LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT);
  const format = ['%H', '%an', '%ae', '%aI', '%s'].join(LOG_FIELD_SEP) + LOG_RECORD_SEP;

  const args = ['log', `--max-count=${limit}`, `--pretty=format:${format}`];
  if (input.range != null) args.push(input.range);
  if (input.path != null) {
    let relPath: string;
    try {
      relPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).canonical.path;
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'get_log', err, { ...input });
      throw err;
    }
    args.push('--', relPath);
  }

  const result = ensureOk('get_log', await git(ctx, args, DIFF_STDOUT_LIMIT_BYTES));
  const commits: GitLogEntry[] = [];
  for (const record of result.stdout.split(LOG_RECORD_SEP)) {
    if (record.length === 0) continue;
    const [sha, authorName, authorEmail, date, subject] = record.split(LOG_FIELD_SEP);
    if (sha == null || sha.length === 0) continue;
    commits.push({
      sha,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      date: date ?? '',
      subject: (subject ?? '').replace(/^\n/, ''),
    });
  }

  emitToolCall(ctx, {
    tool: 'get_log',
    input: { path: input.path ?? null, range: input.range ?? null, limit },
    status: 'ok',
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return { commits, truncated: result.truncated };
}

export interface BlameLine {
  sha: string;
  authorName: string;
  date: string;
  lineNumber: number;
  content: string;
}

export interface GetBlameResult {
  path: RepoRelativePath;
  lines: BlameLine[];
  truncated: boolean;
}

/**
 * Per-line authorship for a workspace-relative file. `--line-porcelain`
 * is verbose but unambiguous to parse — each line emits the same set of
 * header fields followed by a literal `\t<content>` line.
 */
export async function getBlameTool(
  ctx: FactoryContext,
  input: z.infer<typeof GetBlameInput>,
): Promise<GetBlameResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'get_blame', err, { ...input });
    throw err;
  }

  const args = ['blame', '--line-porcelain'];
  if (input.startLine != null) {
    const end = input.endLine ?? input.startLine;
    args.push('-L', `${input.startLine},${end}`);
  }
  args.push('--', resolved.canonical.path);

  const result = ensureOk('get_blame', await git(ctx, args, DIFF_STDOUT_LIMIT_BYTES));
  const lines: BlameLine[] = [];
  let current: Partial<BlameLine> | null = null;

  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('\t')) {
      if (current != null && current.sha != null) {
        lines.push({
          sha: current.sha,
          authorName: current.authorName ?? '',
          date: current.date ?? '',
          lineNumber: current.lineNumber ?? 0,
          content: line.slice(1),
        });
      }
      current = null;
      continue;
    }
    // Header line: `<sha> <orig-line> <final-line> [<count>]` or `<key> <value>`.
    const shaMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (shaMatch) {
      current = { sha: shaMatch[1], lineNumber: Number.parseInt(shaMatch[2], 10) };
      continue;
    }
    if (current == null) continue;
    if (line.startsWith('author ')) {
      current.authorName = line.slice('author '.length);
    } else if (line.startsWith('author-time ')) {
      const epoch = Number.parseInt(line.slice('author-time '.length), 10);
      if (Number.isFinite(epoch)) current.date = new Date(epoch * 1000).toISOString();
    }
  }

  emitToolCall(ctx, {
    tool: 'get_blame',
    input: {
      path: resolved.canonical.path,
      startLine: input.startLine ?? null,
      endLine: input.endLine ?? null,
    },
    status: 'ok',
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return { path: resolved.canonical, lines, truncated: result.truncated };
}
