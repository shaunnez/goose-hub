import type { z } from 'zod';
import { eventStore } from '../../../event-stream/store.js';
import { getProjectBySlug } from '../../../projects/loader.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  CheckAcceptanceCriteriaInput,
  GetPrDiffInput,
  GetVerificationSummaryInput,
  RunFullSuiteIfNeededInput,
  RunIsolatedTestInput,
} from '../schemas.js';
import { getWorkItem } from './context.js';
import { GitCommandError } from './git.js';
import { type VerifyResult, runTestsTool } from './verify.js';

const PR_DIFF_TIMEOUT_MS = 60 * 1000;
const PR_DIFF_STDOUT_LIMIT_BYTES = 1024 * 1024;

export class PrDiffUnavailableError extends Error {
  readonly kind = 'PrDiffUnavailableError' as const;
  readonly prNumber: number;

  constructor(prNumber: number, message: string) {
    super(message);
    this.name = 'PrDiffUnavailableError';
    this.prNumber = prNumber;
  }
}

export interface GetPrDiffResult {
  prNumber: number;
  diff: string;
  truncated: boolean;
  displayTruncated: boolean;
  fullOutputPath?: string;
}

export interface RunFullSuiteIfNeededResult extends VerifyResult {
  skipped: boolean;
  reason?: string;
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
 * Returns the diff for a pull request by number. Today this assumes the
 * worktree has the corresponding PR branch available via a remote ref
 * (`refs/pull/<n>/head` on GitHub clones, or `pr/<n>` for other
 * conventions). We try both and surface PrDiffUnavailableError if neither
 * resolves — wiring a proper GitHub MCP fallback is a workflow-owned
 * concern, not a tool concern, so it lives outside this surface.
 */
export async function getPrDiffTool(
  ctx: FactoryContext,
  input: z.infer<typeof GetPrDiffInput>,
): Promise<GetPrDiffResult> {
  const candidateRefs = [`refs/pull/${input.prNumber}/head`, `pr/${input.prNumber}`];

  let resolvedRef: string | null = null;
  for (const ref of candidateRefs) {
    const verify = await runCommand({
      command: 'git',
      args: ['rev-parse', '--verify', ref],
      cwd: ctx.workspaceRoot,
      runId: ctx.runId,
      timeoutMs: 5_000,
      env: minimalEnv(),
    });
    if (verify.status === 'ok') {
      resolvedRef = ref;
      break;
    }
  }

  if (resolvedRef == null) {
    throw new PrDiffUnavailableError(
      input.prNumber,
      `No local ref for PR ${input.prNumber}. Fetched 'refs/pull/${input.prNumber}/head' or 'pr/${input.prNumber}'?`,
    );
  }

  // Diff against the project's configured default branch rather than a
  // hardcoded `origin/main` so projects with `master`, `develop`, etc.
  // get correct deltas.
  const project = await getProjectBySlug(ctx.projectId);
  const defaultBranch = project?.targetRepo.defaultBranch?.trim() || 'main';
  const baseRef = `origin/${defaultBranch}`;

  const result = await runCommand({
    command: 'git',
    args: ['diff', '--no-color', `${baseRef}...${resolvedRef}`],
    cwd: ctx.workspaceRoot,
    runId: ctx.runId,
    timeoutMs: PR_DIFF_TIMEOUT_MS,
    stdoutLimitBytes: PR_DIFF_STDOUT_LIMIT_BYTES,
    env: minimalEnv(),
  });

  if (result.status !== 'ok') {
    throw new GitCommandError(
      result.exitCode,
      result.stderr,
      `get_pr_diff: git diff failed (exit ${result.exitCode ?? 'null'}): ${result.stderr.trim()}`,
    );
  }

  emitToolCall(ctx, {
    tool: 'get_pr_diff',
    input: { prNumber: input.prNumber },
    status: 'ok',
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return {
    prNumber: input.prNumber,
    diff: result.stdout,
    truncated: result.truncated,
    displayTruncated: result.displayTruncated,
    ...(result.fullOutputPath != null ? { fullOutputPath: result.fullOutputPath } : {}),
  };
}

/**
 * Runs the full test suite by delegating to `runTestsTool` with no `path`
 * narrowing. The "if needed" semantics are workflow-owned (QA decides
 * whether to run the full suite based on diff scope, verification
 * summary, etc.); this tool always runs and reports the result. The
 * decision is recorded for the audit trail via `skipped: false`.
 *
 * `RunFullSuiteIfNeededResult.skipped` is reserved for a future variant
 * that takes a `decision` input describing why a run was skipped.
 */
export async function runFullSuiteIfNeededTool(
  ctx: FactoryContext,
  _input: z.infer<typeof RunFullSuiteIfNeededInput> = {},
): Promise<RunFullSuiteIfNeededResult> {
  const result = await runTestsTool(ctx, {});
  emitToolCall(ctx, {
    tool: 'run_full_suite_if_needed',
    input: {},
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return { ...result, skipped: false };
}

/**
 * Runs the project test command narrowed to a single file. Optional
 * `testName` is passed positionally after the path — vitest, jest, and
 * playwright all accept a name filter as the next argv. The whole-file
 * fallback (no `testName`) routes through `runTestsTool` for shared
 * argv-building; the named-test path constructs the argv directly so
 * unrelated tests in the same file do not run first.
 */
export async function runIsolatedTestTool(
  ctx: FactoryContext,
  input: z.infer<typeof RunIsolatedTestInput>,
): Promise<VerifyResult> {
  let relPath: string;
  try {
    relPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).canonical.path;
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'run_isolated_test', err, { ...input });
    throw err;
  }

  if (input.testName == null) {
    const result = await runTestsTool(ctx, { path: input.path });
    emitToolCall(ctx, {
      tool: 'run_isolated_test',
      input: { path: relPath },
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      truncated: result.truncated,
    });
    return result;
  }

  const project = await getProjectBySlug(ctx.projectId);
  if (project == null || project.stack.testCommand.trim().length === 0) {
    throw new Error(`run_isolated_test: project '${ctx.projectId}' has no testCommand configured.`);
  }

  const argv = project.stack.testCommand
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
  argv.push(relPath, input.testName);

  const narrowed = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    runId: ctx.runId,
    timeoutMs: 5 * 60 * 1000,
    env: minimalEnv(),
  });
  emitToolCall(ctx, {
    tool: 'run_isolated_test',
    input: { path: input.path, testName: input.testName },
    status: narrowed.status,
    exitCode: narrowed.exitCode,
    durationMs: narrowed.durationMs,
    truncated: narrowed.truncated,
  });
  return {
    status: narrowed.status,
    exitCode: narrowed.exitCode,
    stdout: narrowed.stdout,
    stderr: narrowed.stderr,
    durationMs: narrowed.durationMs,
    truncated: narrowed.truncated,
    displayTruncated: narrowed.displayTruncated,
    ...(narrowed.fullOutputPath != null ? { fullOutputPath: narrowed.fullOutputPath } : {}),
    command: argv,
  };
}

export interface GetVerificationSummaryResult {
  available: boolean;
  builtAt: string | null;
  summary: unknown;
}

/**
 * `factory_get_verification_summary` — returns the most recent
 * `qa.verification-summary-built` event for the current work item, or
 * `available: false` when QA hasn't graded yet. The MCP tool does NOT
 * rebuild the summary — that's a workflow concern (slices/qa) — it just
 * surfaces the artifact for the agent to grade against.
 */
export function getVerificationSummaryTool(
  ctx: FactoryContext,
  _input: z.infer<typeof GetVerificationSummaryInput> = {},
): GetVerificationSummaryResult {
  const events = eventStore.replay({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId,
    kind: 'qa.verification-summary-built',
    order: 'desc',
    limit: 1,
  });

  let result: GetVerificationSummaryResult;
  if (events.length === 0) {
    result = { available: false, builtAt: null, summary: null };
  } else {
    const event = events[0];
    result = {
      available: true,
      builtAt: event.createdAt,
      summary: event.payload,
    };
  }

  emitToolCall(ctx, {
    tool: 'get_verification_summary',
    input: {},
    status: 'ok',
  });
  return result;
}

export interface AcceptanceCriterion {
  text: string;
  completed: boolean;
}

export interface CheckAcceptanceCriteriaResult {
  total: number;
  completed: number;
  allCompleted: boolean;
  items: AcceptanceCriterion[];
}

const CHECKBOX_RE = /^\s*[-*]\s+\[(?<state>[ xX])\]\s+(?<text>.+?)\s*$/;

/**
 * `factory_check_acceptance_criteria` — parses `- [ ]` / `- [x]` markdown
 * checkboxes from the work item body and reports completion. Used by QA
 * to grade the implementation against the issue's acceptance criteria
 * without needing to ask the agent to do the parsing.
 */
export async function checkAcceptanceCriteriaTool(
  ctx: FactoryContext,
  _input: z.infer<typeof CheckAcceptanceCriteriaInput> = {},
): Promise<CheckAcceptanceCriteriaResult> {
  const item = await getWorkItem(ctx, {});
  const items: AcceptanceCriterion[] = [];

  for (const line of item.body.split('\n')) {
    const match = line.match(CHECKBOX_RE);
    if (match?.groups != null) {
      items.push({
        text: match.groups.text,
        completed: match.groups.state.toLowerCase() === 'x',
      });
    }
  }

  const completed = items.filter((i) => i.completed).length;
  const result: CheckAcceptanceCriteriaResult = {
    total: items.length,
    completed,
    allCompleted: items.length > 0 && completed === items.length,
    items,
  };

  emitToolCall(ctx, {
    tool: 'check_acceptance_criteria',
    input: {},
    status: 'ok',
  });
  return result;
}
