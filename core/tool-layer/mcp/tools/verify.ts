import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { getProjectBySlug } from '../../../projects/loader.js';
import type { ProjectConfig, StackConfig } from '../../../types.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { type CommandResult, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
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
  command: ReadonlyArray<string>;
}

function tokeniseCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

function toVerifyResult(argv: ReadonlyArray<string>, r: CommandResult): VerifyResult {
  return {
    status: r.status,
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
    durationMs: r.durationMs,
    truncated: r.truncated,
    command: argv,
  };
}

async function loadStack(
  ctx: FactoryContext,
): Promise<{ project: ProjectConfig; stack: StackConfig }> {
  const project = await getProjectBySlug(ctx.projectId);
  if (project == null) {
    throw new StackCommandMissingError('test', ctx.projectId);
  }
  return { project, stack: project.stack };
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
 * (the same convention `core/tool-layer/tools/test.ts` follows) and point
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
  if (input.path != null) {
    let relPath: string;
    try {
      relPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).relative;
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'run_tests', err, { ...input });
      throw err;
    }
    argv.push(relPath);
  }

  const result = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    timeoutMs: TEST_TIMEOUT_MS,
    env: minimalEnv(),
  });

  emitToolCall(ctx, {
    tool: 'run_tests',
    input: { path: input.path ?? null },
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return toVerifyResult(argv, result);
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
      relPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).relative;
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
