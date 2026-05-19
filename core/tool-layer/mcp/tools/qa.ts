import type { z } from 'zod';
import { emitToolCall } from '../audit.js';
import { emitBlockedToolCall } from '../audit.js';
import { type CommandResult, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  GetPrDiffInput,
  RunFullSuiteIfNeededInput,
  RunIsolatedTestInput,
} from '../schemas.js';
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

  const result = await runCommand({
    command: 'git',
    args: ['diff', '--no-color', `origin/main...${resolvedRef}`],
    cwd: ctx.workspaceRoot,
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
  return { prNumber: input.prNumber, diff: result.stdout, truncated: result.truncated };
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
 * playwright all accept a name filter as the next argv, so this is the
 * lowest-common-denominator wiring.
 */
export async function runIsolatedTestTool(
  ctx: FactoryContext,
  input: z.infer<typeof RunIsolatedTestInput>,
): Promise<VerifyResult> {
  // Pre-resolve to surface policy violations through the qa.* audit
  // namespace; runTestsTool also resolves but emits under run_tests.
  try {
    resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'run_isolated_test', err, { ...input });
    throw err;
  }

  // Lean on runTestsTool for the underlying argv + spawn + audit
  // emission, then layer the qa-specific audit on top so the verification
  // call site is attributable.
  const result = await runTestsTool(ctx, { path: input.path });

  if (input.testName != null) {
    // The simple `path` invocation already narrows to a file; running with
    // an additional `testName` requires a second invocation that appends
    // the name as a positional arg. We do that explicitly here so the
    // first call's audit captures the wider surface and the second
    // captures the narrowed name filter.
    const argv = [...result.command, input.testName];
    const narrowed: CommandResult = await runCommand({
      command: argv[0],
      args: argv.slice(1),
      cwd: ctx.workspaceRoot,
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
      command: argv,
    };
  }

  emitToolCall(ctx, {
    tool: 'run_isolated_test',
    input: { path: input.path },
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return result;
}
