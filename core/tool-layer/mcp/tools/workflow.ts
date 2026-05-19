import type { z } from 'zod';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { type CommandResult, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type { CommitChangesInput, StageChangesInput } from '../schemas.js';

const GIT_TIMEOUT_MS = 30 * 1000;

export class GitMutationError extends Error {
  readonly kind = 'GitMutationError' as const;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(exitCode: number | null, stderr: string, message: string) {
    super(message);
    this.name = 'GitMutationError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface StageChangesResult {
  staged: string[];
}

export interface CommitChangesResult {
  sha: string;
  message: string;
}

async function git(ctx: FactoryContext, args: ReadonlyArray<string>): Promise<CommandResult> {
  return runCommand({
    command: 'git',
    args,
    cwd: ctx.workspaceRoot,
    timeoutMs: GIT_TIMEOUT_MS,
    env: minimalEnv(),
  });
}

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
 * Stages workspace-relative paths via `git add`. With no paths, stages all
 * tracked + untracked changes (`git add -A`). Path policy applies to every
 * supplied path; absolute paths and `.codex` / `.claude` / `.factory` are
 * rejected before invoking git.
 *
 * Workflow-owned: not registered with the MCP server's agent surface.
 * Workflows that intentionally delegate this operation call the function
 * directly.
 */
export async function stageChangesTool(
  ctx: FactoryContext,
  input: z.infer<typeof StageChangesInput>,
): Promise<StageChangesResult> {
  const paths = input.paths ?? [];
  const resolved: string[] = [];

  for (const path of paths) {
    try {
      const r = resolveWorkspacePath(ctx.workspaceRoot, path);
      resolved.push(r.relative);
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'stage_changes', err, { paths });
      throw err;
    }
  }

  const args = paths.length === 0 ? ['add', '-A'] : ['add', '--', ...resolved];
  const result = await git(ctx, args);
  if (result.status !== 'ok') {
    throw new GitMutationError(
      result.exitCode,
      result.stderr,
      `stage_changes: git add failed (exit ${result.exitCode ?? 'null'}): ${result.stderr.trim()}`,
    );
  }

  emitToolCall(ctx, {
    tool: 'stage_changes',
    input: { count: paths.length },
    status: 'ok',
    durationMs: result.durationMs,
  });
  return { staged: resolved };
}

/**
 * Commits the staged index with the supplied message. The commit author is
 * the git config configured on the worktree — Factory does not override
 * it. Signing follows whatever the worktree's git config dictates; if a
 * signing hook fails, the GitMutationError surfaces the stderr so the
 * workflow can decide how to react.
 */
export async function commitChangesTool(
  ctx: FactoryContext,
  input: z.infer<typeof CommitChangesInput>,
): Promise<CommitChangesResult> {
  const result = await git(ctx, ['commit', '-m', input.message]);
  if (result.status !== 'ok') {
    throw new GitMutationError(
      result.exitCode,
      result.stderr,
      `commit_changes: git commit failed (exit ${result.exitCode ?? 'null'}): ${result.stderr.trim()}`,
    );
  }

  const headResult = await git(ctx, ['rev-parse', 'HEAD']);
  if (headResult.status !== 'ok') {
    throw new GitMutationError(
      headResult.exitCode,
      headResult.stderr,
      `commit_changes: git rev-parse HEAD failed after commit: ${headResult.stderr.trim()}`,
    );
  }
  const sha = headResult.stdout.trim();

  emitToolCall(ctx, {
    tool: 'commit_changes',
    input: { messageLength: input.message.length },
    status: 'ok',
    durationMs: result.durationMs,
  });
  return { sha, message: input.message };
}
