/**
 * tools/workflow.ts — **status: unused / deprecated until adopted**.
 *
 * These helpers were drafted in Phase 3 of ADR 0045 as typed wrappers
 * around git + GitHub API operations that workflows could import directly
 * (NOT registered with the MCP server, NOT in any agent bundle).
 *
 * As of today, nothing imports them. The existing workflow code at
 * `slices/fix-issue/evidence-post-workflow.ts`, the `core/connectors/github/*`
 * helpers, and `GitHubLabelsSource` already cover the same operations
 * with shapes the workflows are wired against. Adopting these wrappers
 * would also require reshaping the audit story (`emitToolCall` is meant
 * for agent calls; workflow ops are not agent actions).
 *
 * Kept in tree as a reference surface in case a future refactor wants
 * uniform typed entry points. Delete this file rather than maintain
 * dead code if that refactor never happens.
 */
import type { z } from 'zod';
import { openPR } from '../../../connectors/github/open-pr.js';
import { transitionAndEmitState } from '../../../event-stream/state-transition.js';
import type { StateName } from '../../../state-machine/states.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { type CommandResult, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  CommitChangesInput,
  OpenPrInput,
  PostIssueCommentInput,
  StageChangesInput,
  TransitionStateInput,
  UpdatePrInput,
} from '../schemas.js';
import { getStateSourceForProject, resolveGitHubToken } from './_github.js';

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
      resolved.push(r.canonical.path);
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

export interface OpenPrResult {
  prNumber: number;
  prUrl: string;
}

/**
 * Pushes the current branch to origin and opens a pull request via the
 * GitHub REST API. Caller must ensure body contains `Closes #N` (the
 * underlying `openPR` connector validates this).
 *
 * Workflow-owned — not exposed to agents. Branch name is derived from
 * the current HEAD's branch (read via `git rev-parse --abbrev-ref HEAD`)
 * so the workflow doesn't have to thread it through.
 */
export async function openPrTool(
  ctx: FactoryContext,
  input: z.infer<typeof OpenPrInput>,
): Promise<OpenPrResult> {
  const branchResult = await git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branchResult.status !== 'ok') {
    throw new GitMutationError(
      branchResult.exitCode,
      branchResult.stderr,
      `open_pr: git rev-parse --abbrev-ref HEAD failed: ${branchResult.stderr.trim()}`,
    );
  }
  const branchName = branchResult.stdout.trim();

  const source = await getStateSourceForProject(ctx.projectId);
  const issueMatch = ctx.workItemId.match(/#(\d+)$/);
  if (issueMatch == null) {
    throw new GitMutationError(
      null,
      '',
      `open_pr: cannot derive issue number from workItemId '${ctx.workItemId}'.`,
    );
  }
  const issueNumber = Number.parseInt(issueMatch[1], 10);

  const result = await openPR({
    worktreePath: ctx.workspaceRoot,
    repo: source.repoRef,
    issueNumber,
    title: input.title,
    body: input.body ?? `Closes #${issueNumber}`,
    branchName,
    baseBranch: input.base,
    token: resolveGitHubToken(),
  });

  emitToolCall(ctx, {
    tool: 'open_pr',
    input: { issueNumber, branchName, base: input.base ?? 'main' },
    status: 'ok',
  });
  return { prNumber: result.prNumber, prUrl: result.prUrl };
}

export interface UpdatePrResult {
  prNumber: number;
  updated: ReadonlyArray<'title' | 'body'>;
}

/**
 * PATCH `/repos/<repo>/pulls/<n>` with title and/or body updates.
 * Workflow-owned — not exposed to agents.
 */
export async function updatePrTool(
  ctx: FactoryContext,
  input: z.infer<typeof UpdatePrInput>,
): Promise<UpdatePrResult> {
  const source = await getStateSourceForProject(ctx.projectId);
  const token = resolveGitHubToken();
  const payload: Record<string, string> = {};
  const updated: Array<'title' | 'body'> = [];
  if (input.title != null) {
    payload.title = input.title;
    updated.push('title');
  }
  if (input.body != null) {
    payload.body = input.body;
    updated.push('body');
  }

  const response = await fetch(
    `https://api.github.com/repos/${source.repoRef}/pulls/${input.prNumber}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new GitMutationError(
      response.status,
      text,
      `update_pr: PATCH /pulls/${input.prNumber} failed (${response.status}): ${text}`,
    );
  }

  emitToolCall(ctx, {
    tool: 'update_pr',
    input: { prNumber: input.prNumber, updated },
    status: 'ok',
  });
  return { prNumber: input.prNumber, updated };
}

export interface PostIssueCommentResult {
  issueNumber: number;
}

/**
 * Posts a comment to the run's work item (or an explicit issue number).
 * Workflow-owned. Wraps `GitHubLabelsSource.comment()`.
 */
export async function postIssueCommentTool(
  ctx: FactoryContext,
  input: z.infer<typeof PostIssueCommentInput>,
): Promise<PostIssueCommentResult> {
  const source = await getStateSourceForProject(ctx.projectId);
  const itemId = `github:${source.repoRef}#${input.issueNumber}`;
  await source.comment(itemId, input.body);

  emitToolCall(ctx, {
    tool: 'post_issue_comment',
    input: { issueNumber: input.issueNumber, bodyLength: input.body.length },
    status: 'ok',
  });
  return { issueNumber: input.issueNumber };
}

export interface TransitionStateResult {
  issueNumber: number;
  from: StateName;
  to: StateName;
}

/**
 * Transitions the work item from its current state to `to`. Reads the
 * current state first to satisfy the legal-transition check inside
 * `GitHubLabelsSource.transitionState()`. Workflow-owned.
 */
export async function transitionStateTool(
  ctx: FactoryContext,
  input: z.infer<typeof TransitionStateInput>,
): Promise<TransitionStateResult> {
  const source = await getStateSourceForProject(ctx.projectId);
  const itemId = `github:${source.repoRef}#${input.issueNumber}`;
  const current = await source.getItem(itemId);
  const to = input.to as StateName;
  await transitionAndEmitState({
    mode: 'legal',
    source,
    itemId,
    projectId: ctx.projectId,
    workItemId: current.id,
    from: current.state,
    to,
    by: 'mcp.transition_state',
    runId: ctx.runId,
  });

  emitToolCall(ctx, {
    tool: 'transition_state',
    input: { issueNumber: input.issueNumber, from: current.state, to },
    status: 'ok',
  });
  return { issueNumber: input.issueNumber, from: current.state, to };
}
