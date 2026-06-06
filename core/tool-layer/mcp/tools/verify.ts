import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { eventStore } from '../../../event-stream/store.js';
import { getProjectBySlug } from '../../../projects/loader.js';
import type { ProjectConfig, StackConfig } from '../../../types.js';
import { stackCommandsForWorktree } from '../../../workspaces/stack-commands.js';
import type { RepoRelativePath } from '../../path-contract.js';
import { type ParsedTestFailures, parseTestFailures } from '../../test-failure-parser.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { type CommandResult, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import {
  clearTestFailureCounter,
  consecutiveTestFailures,
  recordTestFailure,
  recordTestFailureSignature,
  testRetryCap,
} from '../run-cache.js';
import type {
  RunLintInput,
  RunPackageScriptInput,
  RunTargetedCommandInput,
  RunTestsInput,
  RunTypecheckInput,
} from '../schemas.js';

const TEST_TIMEOUT_MS = 5 * 60 * 1000;
const LINT_TIMEOUT_MS = 90 * 1000;
const TYPECHECK_TIMEOUT_MS = 3 * 60 * 1000;
const PACKAGE_SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;
const E2E_PATH_PREFIX = 'apps/web/e2e';

export class StackCommandMissingError extends Error {
  readonly kind = 'StackCommandMissingError' as const;
  readonly family: 'test' | 'lint' | 'typecheck';

  constructor(family: 'test' | 'lint' | 'typecheck', projectId: string) {
    super(`Project '${projectId}' has no ${family}Command configured.`);
    this.name = 'StackCommandMissingError';
    this.family = family;
  }
}

export class PackageScriptNotAllowedError extends Error {
  readonly kind = 'PackageScriptNotAllowedError' as const;
  readonly script: string;

  constructor(script: string, message: string) {
    super(message);
    this.name = 'PackageScriptNotAllowedError';
    this.script = script;
  }
}

export interface VerifyResult {
  status: 'ok' | 'failed' | 'timed_out';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  displayTruncated: boolean;
  fullOutputPath?: string;
  command: ReadonlyArray<string>;
  blocked?: true;
  blockedReason?: string;
  rawPaths?: string[];
  paths?: RepoRelativePath[];
  /**
   * Parsed test-failure summary for `run_tests` — populated when the
   * underlying command failed and the output was recognisable as Vitest
   * (JSON or text). Caps failure list at 5 to keep prompt cost down.
   */
  failureSummary?: ParsedTestFailures;
}

function tokeniseCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

function toVerifyResult(
  argv: ReadonlyArray<string>,
  r: CommandResult,
  paths?: { rawPaths: string[]; paths: RepoRelativePath[] },
): VerifyResult {
  return {
    status: r.status,
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
    durationMs: r.durationMs,
    truncated: r.truncated,
    displayTruncated: r.displayTruncated ?? false,
    command: argv,
    ...(r.fullOutputPath != null ? { fullOutputPath: r.fullOutputPath } : {}),
    ...(paths != null && paths.rawPaths.length > 0 ? { rawPaths: paths.rawPaths } : {}),
    ...(paths != null && paths.paths.length > 0 ? { paths: paths.paths } : {}),
  };
}

async function loadStack(
  ctx: FactoryContext,
): Promise<{ project: ProjectConfig; stack: StackConfig }> {
  const project = await getProjectBySlug(ctx.projectId);
  if (project == null) {
    throw new StackCommandMissingError('test', ctx.projectId);
  }
  return { project, stack: await stackCommandsForWorktree(ctx.workspaceRoot, project.stack) };
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
 * Runs the project's `testCommand`. An optional workspace-relative `path`
 * narrows scope to that file or directory; otherwise the project's full
 * suite runs.
 *
 * The command string is tokenised on whitespace. Projects whose test
 * invocation needs quoted args should wrap them in a `package.json` script
 * (the same convention package.json scripts follow) and point
 * `testCommand` at the script.
 */
export async function runTestsTool(
  ctx: FactoryContext,
  input: z.infer<typeof RunTestsInput>,
): Promise<VerifyResult> {
  const { stack } = await loadStack(ctx);
  if (stack.testCommand == null || stack.testCommand.trim().length === 0) {
    throw new StackCommandMissingError('test', ctx.projectId);
  }

  const argv = tokeniseCommand(stack.testCommand);
  let pathMetadata: { rawPaths: string[]; paths: RepoRelativePath[] } | undefined;
  if (input.path != null) {
    let canonical: RepoRelativePath;
    try {
      canonical = resolveWorkspacePath(ctx.workspaceRoot, input.path).canonical;
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'run_tests', err, { ...input });
      throw err;
    }
    argv.push(canonical.path);
    pathMetadata = { rawPaths: [input.path], paths: [canonical] };
  }

  if (pathMetadata?.paths.some((path) => isE2eOwnedPath(path.path)) === true) {
    const blocked = buildE2eOwnedBlockedResult(argv, pathMetadata);
    emitBlockedToolCall(ctx, {
      tool: 'run_tests',
      input: {
        path: input.path ?? null,
        command: argv.join(' '),
        rawPaths: pathMetadata.rawPaths,
        paths: pathMetadata.paths.map((path) => path.path),
      },
      blocked: true,
      reason: 'e2e_owned_path',
      message: blocked.stderr,
    });
    return blocked;
  }

  const retryPathKey = pathMetadata?.paths[0]?.path ?? null;
  const cap = testRetryCap();
  const priorFailures = consecutiveTestFailures(ctx.runId, retryPathKey);
  if (priorFailures >= cap) {
    const blocked = buildRetryCapBlockedResult(argv, cap, priorFailures, retryPathKey);
    emitBlockedToolCall(ctx, {
      tool: 'run_tests',
      input: {
        path: input.path ?? null,
        command: argv.join(' '),
        rawPaths: pathMetadata?.rawPaths ?? [],
        paths: pathMetadata?.paths.map((path) => path.path) ?? [],
      },
      blocked: true,
      reason: 'excessive_test_retries',
      message: blocked.stderr,
    });
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'tool.violation',
      payload: {
        tool: 'run_tests',
        reason: 'excessive-test-retries',
        path: retryPathKey,
        consecutiveFailures: priorFailures,
        cap,
        guidance:
          'Edit the failing source or test before retrying. Read the assertion, classify the failure, then make a targeted change.',
      },
    });
    return blocked;
  }

  const result = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    runId: ctx.runId,
    displayOutput: true,
    timeoutMs: TEST_TIMEOUT_MS,
    env: minimalEnv({ NODE_ENV: 'test' }),
  });

  if (result.status === 'ok') {
    clearTestFailureCounter(ctx.runId, retryPathKey);
  } else if (result.status === 'failed') {
    recordTestFailure(ctx.runId, retryPathKey);
  }

  const failureSummary =
    result.status === 'failed'
      ? parseTestFailures({ stdout: result.stdout, stderr: result.stderr })
      : undefined;
  const failureSignature =
    result.status === 'failed'
      ? buildTestFailureSignature({ stdout: result.stdout, stderr: result.stderr, failureSummary })
      : null;
  const signatureRecord =
    failureSignature != null
      ? recordTestFailureSignature(ctx.runId, failureSignature, retryPathKey)
      : null;

  emitToolCall(ctx, {
    tool: 'run_tests',
    input: {
      path: input.path ?? null,
      command: argv.join(' '),
      rawPaths: pathMetadata?.rawPaths ?? [],
      paths: pathMetadata?.paths.map((path) => path.path) ?? [],
    },
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  if (signatureRecord != null && signatureRecord.count >= cap && signatureRecord.paths.length > 1) {
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'tool.violation',
      payload: {
        tool: 'run_tests',
        reason: 'repeated-test-failure-signature',
        signature: signatureRecord.signature,
        paths: signatureRecord.paths,
        consecutiveFailures: signatureRecord.count,
        cap,
        guidance:
          'The same test failure signature repeated across targets. Stop rotating test files; classify whether this is product code, test setup, or verification infrastructure, then edit the relevant source or setup.',
      },
    });
    const blocked = buildRetrySignatureBlockedResult(argv, signatureRecord);
    return failureSummary != null ? { ...blocked, failureSummary } : blocked;
  }
  const verifyResult = toVerifyResult(argv, result, pathMetadata);
  return failureSummary != null ? { ...verifyResult, failureSummary } : verifyResult;
}

function isE2eOwnedPath(path: string): boolean {
  const normalized = path.replace(/^\.\//, '').replace(/\/+$/, '');
  return normalized === E2E_PATH_PREFIX || normalized.startsWith(`${E2E_PATH_PREFIX}/`);
}

function buildE2eOwnedBlockedResult(
  argv: ReadonlyArray<string>,
  paths: { rawPaths: string[]; paths: RepoRelativePath[] },
): VerifyResult {
  const canonicalPaths = paths.paths.map((path) => path.path);
  return {
    status: 'failed',
    exitCode: null,
    stdout: '',
    stderr: `[harness] run_tests does not run Playwright e2e paths (${canonicalPaths.join(', ')}). E2e specs are QA/evidence-owned; add or run unit/component tests here, or let QA run the project's e2eCommand.`,
    durationMs: 0,
    truncated: false,
    displayTruncated: false,
    command: argv,
    rawPaths: paths.rawPaths,
    paths: paths.paths,
    blocked: true,
    blockedReason: 'e2e_owned_path',
  };
}

function buildRetryCapBlockedResult(
  argv: ReadonlyArray<string>,
  cap: number,
  observed: number,
  retryPathKey: string | null,
): VerifyResult {
  const pathLabel = retryPathKey ?? '<all>';
  return {
    status: 'failed',
    exitCode: null,
    stdout: '',
    stderr: `[harness] run_tests retry cap reached (${observed}/${cap} consecutive failures on ${pathLabel}). Edit the failing source or test before invoking run_tests again — read the prior failure output, classify the cause, then make a targeted change.`,
    durationMs: 0,
    truncated: false,
    displayTruncated: false,
    command: argv,
    blocked: true,
    blockedReason: 'excessive_test_retries',
  };
}

function buildRetrySignatureBlockedResult(
  argv: ReadonlyArray<string>,
  record: { signature: string; count: number; paths: string[] },
): VerifyResult {
  return {
    status: 'failed',
    exitCode: null,
    stdout: '',
    stderr: `[harness] run_tests stopped after repeated failure signature (${record.count} failures across ${record.paths.length} targets): ${record.signature}. Stop rotating test files; classify whether this is product code, test setup, or verification infrastructure, then edit the relevant source or setup.`,
    durationMs: 0,
    truncated: false,
    displayTruncated: false,
    command: argv,
    blocked: true,
    blockedReason: 'repeated_test_failure_signature',
  };
}

function buildTestFailureSignature(input: {
  stdout: string;
  stderr: string;
  failureSummary?: ParsedTestFailures;
}): string | null {
  const parsedFailure = input.failureSummary?.failures[0];
  const parsedAssertion = normalizeFailureSignatureText(parsedFailure?.assertion);
  if (parsedAssertion != null) {
    return `${parsedFailure?.category ?? 'unknown'}:${parsedAssertion}`;
  }

  const raw = normalizeFailureSignatureText(
    firstUsefulFailureLine(`${input.stdout}\n${input.stderr}`),
  );
  return raw != null ? `raw:${raw}` : null;
}

function firstUsefulFailureLine(text: string): string | null {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (/^(run|test files|tests|start at|duration)\b/i.test(line)) continue;
    if (/^(stdout|stderr)\s*\|/i.test(line)) continue;
    if (
      /(error|typeerror|referenceerror|cannot find module|failed to load|uncaught|unhandled)/i.test(
        line,
      )
    ) {
      return line;
    }
  }
  return null;
}

function normalizeFailureSignatureText(text: string | undefined | null): string | null {
  if (text == null) return null;
  const trimmed = text
    .replace(/\/[^\s)]+\/([^/\s)]+\.(?:t|j)sx?)(?::\d+)?(?::\d+)?/g, '$1')
    .replace(/\b\d+ms\b/g, '<duration>')
    .replace(/\b\d+:\d+\b/g, '<line>')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 240);
}

export async function runLintTool(
  ctx: FactoryContext,
  input: z.infer<typeof RunLintInput>,
): Promise<VerifyResult> {
  const { stack } = await loadStack(ctx);
  if (stack.lintCommand == null || stack.lintCommand.trim().length === 0) {
    throw new StackCommandMissingError('lint', ctx.projectId);
  }

  const argv = tokeniseCommand(stack.lintCommand);
  if (input.path != null) {
    let relPath: string;
    try {
      relPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).canonical.path;
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'run_lint', err, { ...input });
      throw err;
    }
    argv.push(relPath);
  }

  const result = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    runId: ctx.runId,
    displayOutput: true,
    timeoutMs: LINT_TIMEOUT_MS,
    env: minimalEnv(),
  });

  emitToolCall(ctx, {
    tool: 'run_lint',
    input: { path: input.path ?? null },
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return toVerifyResult(argv, result);
}

export async function runTypecheckTool(
  ctx: FactoryContext,
  _input: z.infer<typeof RunTypecheckInput> = {},
): Promise<VerifyResult> {
  const { stack } = await loadStack(ctx);
  if (stack.typecheckCommand == null || stack.typecheckCommand.trim().length === 0) {
    throw new StackCommandMissingError('typecheck', ctx.projectId);
  }

  const argv = tokeniseCommand(stack.typecheckCommand);
  const result = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    runId: ctx.runId,
    displayOutput: true,
    timeoutMs: TYPECHECK_TIMEOUT_MS,
    env: minimalEnv(),
  });

  emitToolCall(ctx, {
    tool: 'run_typecheck',
    input: {},
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return toVerifyResult(argv, result);
}

/**
 * Runs a `package.json` script via the project's package manager. The
 * script name must exist in `<workspaceRoot>/package.json#scripts`; the
 * Zod input regex prevents shell metacharacters, and the lookup prevents
 * smuggling arbitrary commands through unrecognized script names.
 *
 * Role-based script allowlists (per ADR 0045) are wired in Phase 5 when
 * bundle migration lands; today every script in `scripts` is accepted.
 */
export async function runPackageScriptTool(
  ctx: FactoryContext,
  input: z.infer<typeof RunPackageScriptInput>,
): Promise<VerifyResult> {
  const { stack } = await loadStack(ctx);
  const pm = stack.packageManager;
  const allowed = await readPackageScripts(ctx.workspaceRoot);
  if (!allowed.has(input.script)) {
    throw new PackageScriptNotAllowedError(
      input.script,
      `Script '${input.script}' is not declared in package.json.`,
    );
  }

  const argv = [pm, 'run', input.script];
  const result = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    runId: ctx.runId,
    displayOutput: true,
    timeoutMs: PACKAGE_SCRIPT_TIMEOUT_MS,
    env: minimalEnv(),
  });

  emitToolCall(ctx, {
    tool: 'run_package_script',
    input: { script: input.script },
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return toVerifyResult(argv, result);
}

async function readPackageScripts(workspaceRoot: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(workspaceRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return new Set(Object.keys(parsed.scripts ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * Convenience wrapper for running test/lint/typecheck narrowed to a single
 * path. Resolves to the same underlying tools so audit emission and
 * timeouts stay consistent.
 */
export async function runTargetedCommandTool(
  ctx: FactoryContext,
  input: z.infer<typeof RunTargetedCommandInput>,
): Promise<VerifyResult> {
  switch (input.family) {
    case 'test':
      return runTestsTool(ctx, { path: input.path });
    case 'lint':
      return runLintTool(ctx, { path: input.path });
    case 'typecheck':
      return runTypecheckTool(ctx, {});
  }
}
