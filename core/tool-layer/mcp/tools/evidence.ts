import type { z } from 'zod';
import { getProjectBySlug } from '../../../projects/loader.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  GetAppUrlInput,
  RunPlaywrightSpecInput,
  WritePlaywrightSpecInput,
} from '../schemas.js';
import type { VerifyResult } from './verify.js';
import { writeFileTool } from './write.js';

const PLAYWRIGHT_TIMEOUT_MS = 10 * 60 * 1000;
const PLAYWRIGHT_STDOUT_LIMIT_BYTES = 512 * 1024;

const ALLOWED_SPEC_PREFIXES = ['apps/web/e2e/'];
const SPEC_FILENAME_RE = /\.spec\.tsx?$/;

export class EvidenceConfigMissingError extends Error {
  readonly kind = 'EvidenceConfigMissingError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'EvidenceConfigMissingError';
  }
}

export class SpecPathRejectedError extends Error {
  readonly kind = 'SpecPathRejectedError' as const;
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = 'SpecPathRejectedError';
    this.path = path;
  }
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

function assertSpecPath(path: string): void {
  const ok =
    ALLOWED_SPEC_PREFIXES.some((prefix) => path.startsWith(prefix)) && SPEC_FILENAME_RE.test(path);
  if (!ok) {
    throw new SpecPathRejectedError(
      path,
      `Playwright specs must live under apps/web/e2e/ and end in .spec.ts(x): got '${path}'`,
    );
  }
}

export interface GetAppUrlResult {
  url: string | null;
  source: 'env' | 'unset';
}

/**
 * Returns the URL the workflow has the app running at. The workflow sets
 * `FACTORY_APP_URL` when it spawns a Playwright-capable agent; we don't
 * try to guess by probing localhost ports — that would silently bind to
 * whatever happens to be listening.
 */
export function getAppUrlTool(
  ctx: FactoryContext,
  _input: z.infer<typeof GetAppUrlInput> = {},
): GetAppUrlResult {
  const url = process.env.FACTORY_APP_URL?.trim();
  const result: GetAppUrlResult =
    url != null && url.length > 0 ? { url, source: 'env' } : { url: null, source: 'unset' };
  emitToolCall(ctx, {
    tool: 'get_app_url',
    input: {},
    status: 'ok',
  });
  return result;
}

/**
 * Writes a Playwright spec. The path must live under `apps/web/e2e/` and
 * end in `.spec.ts(x)` — the agent does not get to write specs into
 * arbitrary locations even within the worktree, because Playwright's
 * test discovery and CI's job selection both key off the e2e directory.
 */
export async function writePlaywrightSpecTool(
  ctx: FactoryContext,
  input: z.infer<typeof WritePlaywrightSpecInput>,
): Promise<{ path: string; bytesWritten: number; created: boolean }> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'write_playwright_spec', err, { ...input });
    throw err;
  }

  assertSpecPath(resolved.relative);

  const written = await writeFileTool(ctx, { path: resolved.relative, content: input.content });

  emitToolCall(ctx, {
    tool: 'write_playwright_spec',
    input: { path: resolved.relative, created: written.created },
    status: 'ok',
  });
  return written;
}

/**
 * Runs a Playwright spec via the project's `e2eCommand`. Spec path is
 * passed positionally; the workflow's environment (`FACTORY_APP_URL`,
 * mock-mode env vars) is propagated alongside the minimal env baseline.
 */
export async function runPlaywrightSpecTool(
  ctx: FactoryContext,
  input: z.infer<typeof RunPlaywrightSpecInput>,
): Promise<VerifyResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.spec);
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'run_playwright_spec', err, { ...input });
    throw err;
  }

  assertSpecPath(resolved.relative);

  const project = await getProjectBySlug(ctx.projectId);
  if (
    project == null ||
    project.stack.e2eCommand == null ||
    project.stack.e2eCommand.trim().length === 0
  ) {
    throw new EvidenceConfigMissingError(
      `Project '${ctx.projectId}' has no e2eCommand configured.`,
    );
  }

  const argv = project.stack.e2eCommand
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
  argv.push(resolved.relative);
  if (input.project != null) argv.push('--project', input.project);

  const extraEnv: Record<string, string> = {};
  if (process.env.FACTORY_APP_URL != null) extraEnv.FACTORY_APP_URL = process.env.FACTORY_APP_URL;
  if (process.env.MOCK_AGENTS != null) extraEnv.MOCK_AGENTS = process.env.MOCK_AGENTS;
  if (process.env.MOCK_SOURCE != null) extraEnv.MOCK_SOURCE = process.env.MOCK_SOURCE;

  const result = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
    stdoutLimitBytes: PLAYWRIGHT_STDOUT_LIMIT_BYTES,
    env: minimalEnv(extraEnv),
  });

  emitToolCall(ctx, {
    tool: 'run_playwright_spec',
    input: { spec: resolved.relative, project: input.project ?? null },
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
  });
  return {
    status: result.status,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    truncated: result.truncated,
    command: argv,
  };
}
