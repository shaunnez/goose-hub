import { existsSync } from 'node:fs';
import type { z } from 'zod';
import {
  type PlaywrightEvidence,
  collectPlaywrightEvidence,
} from '../../../../scripts/collect-playwright-evidence.js';
import { getProjectBySlug } from '../../../projects/loader.js';
import type { RepoRelativePath } from '../../path-contract.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  CollectEvidenceInput,
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

export class EvidenceWorkItemIdError extends Error {
  readonly kind = 'EvidenceWorkItemIdError' as const;
  readonly workItemId: string;

  constructor(workItemId: string) {
    super(`collect_evidence: cannot derive a GitHub issue number from workItemId '${workItemId}'.`);
    this.name = 'EvidenceWorkItemIdError';
    this.workItemId = workItemId;
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
): Promise<{ path: RepoRelativePath; bytesWritten: number; created: boolean }> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'write_playwright_spec', err, { ...input });
    throw err;
  }

  assertSpecPath(resolved.canonical.path);

  const written = await writeFileTool(ctx, {
    path: resolved.canonical.path,
    content: input.content,
  });

  emitToolCall(ctx, {
    tool: 'write_playwright_spec',
    input: { path: resolved.canonical.path, created: written.created },
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

  assertSpecPath(resolved.canonical.path);

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
  argv.push(resolved.canonical.path);
  if (input.project != null) argv.push('--project', input.project);

  const extraEnv: Record<string, string> = {};
  if (process.env.FACTORY_APP_URL != null) extraEnv.FACTORY_APP_URL = process.env.FACTORY_APP_URL;
  if (process.env.MOCK_AGENTS != null) extraEnv.MOCK_AGENTS = process.env.MOCK_AGENTS;
  if (process.env.MOCK_SOURCE != null) extraEnv.MOCK_SOURCE = process.env.MOCK_SOURCE;

  const result = await runCommand({
    command: argv[0],
    args: argv.slice(1),
    cwd: ctx.workspaceRoot,
    runId: ctx.runId,
    timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
    stdoutLimitBytes: PLAYWRIGHT_STDOUT_LIMIT_BYTES,
    env: minimalEnv(extraEnv),
  });

  emitToolCall(ctx, {
    tool: 'run_playwright_spec',
    input: { spec: resolved.canonical.path, project: input.project ?? null },
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
    displayTruncated: result.displayTruncated,
    ...(result.fullOutputPath != null ? { fullOutputPath: result.fullOutputPath } : {}),
    command: argv,
  };
}

export interface CollectEvidenceResult {
  evidence: PlaywrightEvidence;
  resultsPath: RepoRelativePath;
  evidenceDir: RepoRelativePath;
}

function extractIssueNumber(workItemId: string): number | null {
  // workItemId: "github:owner/repo#42"
  const match = workItemId.match(/#(\d+)$/);
  if (match == null) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * `factory_collect_evidence` — wraps `scripts/collect-playwright-evidence.ts`
 * as a typed function call (no subprocess spawn). Reads the Playwright
 * results JSON at `resultsPath`, copies videos/screenshots into the
 * evidence dir (default `evidence/<issue>/`), and returns the structured
 * PlaywrightEvidence record the workflow uses to grade.
 *
 * The agent supplies `resultsPath` + `phase`; Factory derives the issue
 * number from `ctx.workItemId` and the slug from the project config so
 * the agent cannot misdirect the artefacts.
 */
export async function collectEvidenceTool(
  ctx: FactoryContext,
  input: z.infer<typeof CollectEvidenceInput>,
): Promise<CollectEvidenceResult> {
  const issue = extractIssueNumber(ctx.workItemId);
  if (issue == null) throw new EvidenceWorkItemIdError(ctx.workItemId);

  const project = await getProjectBySlug(ctx.projectId);
  if (project == null) {
    throw new EvidenceConfigMissingError(`No project config found for slug '${ctx.projectId}'.`);
  }

  let resultsAbsolute: string;
  let resultsCanonical: RepoRelativePath;
  try {
    const resolved = resolveWorkspacePath(ctx.workspaceRoot, input.resultsPath);
    resultsAbsolute = resolved.absolute;
    resultsCanonical = resolved.canonical;
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'collect_evidence', err, { ...input });
    throw err;
  }
  if (!existsSync(resultsAbsolute)) {
    throw new EvidenceConfigMissingError(`Playwright results not found at ${input.resultsPath}.`);
  }

  let evidenceDirCanonical: RepoRelativePath;
  let evidenceDirAbsolute: string;
  const evidenceDirRaw = input.evidenceDir ?? `evidence/${issue}`;
  try {
    const resolved = resolveWorkspacePath(ctx.workspaceRoot, evidenceDirRaw);
    evidenceDirCanonical = resolved.canonical;
    evidenceDirAbsolute = resolved.absolute;
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'collect_evidence', err, { ...input, evidenceDir: evidenceDirRaw });
    throw err;
  }

  const evidence = collectPlaywrightEvidence({
    issue,
    slug: project.slug,
    resultsPath: resultsAbsolute,
    evidenceDir: evidenceDirAbsolute,
    phase: input.phase ?? 'before',
    runFfmpeg: input.skipFfmpeg !== true,
  });

  emitToolCall(ctx, {
    tool: 'collect_evidence',
    input: { resultsPath: input.resultsPath, phase: input.phase ?? 'before' },
    status: 'ok',
  });
  return {
    evidence,
    resultsPath: resultsCanonical,
    evidenceDir: evidenceDirCanonical,
  };
}
