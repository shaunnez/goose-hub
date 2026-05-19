import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  ApplyPatchInput,
  CreateDirectoryInput,
  DeleteFileInput,
  EditFileInput,
  MoveFileInput,
  WriteFileInput,
} from '../schemas.js';

const APPLY_PATCH_TIMEOUT_MS = 30_000;

export class EditMatchError extends Error {
  readonly kind = 'EditMatchError' as const;
  readonly matchCount: number;

  constructor(matchCount: number, message: string) {
    super(message);
    this.name = 'EditMatchError';
    this.matchCount = matchCount;
  }
}

export class ApplyPatchError extends Error {
  readonly kind = 'ApplyPatchError' as const;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(exitCode: number | null, stderr: string, message: string) {
    super(message);
    this.name = 'ApplyPatchError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class DeleteKindError extends Error {
  readonly kind = 'DeleteKindError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DeleteKindError';
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

export interface WriteFileResult {
  path: string;
  bytesWritten: number;
  created: boolean;
}

/**
 * Writes content to a workspace-relative path. Parent directories are
 * created on demand to match the ergonomics of native Write; `created`
 * distinguishes a fresh file from an overwrite for the audit trail.
 */
export async function writeFileTool(
  ctx: FactoryContext,
  input: z.infer<typeof WriteFileInput>,
): Promise<WriteFileResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'write_file', err, { ...input });
    throw err;
  }

  let created = true;
  try {
    await stat(resolved.absolute);
    created = false;
  } catch {
    created = true;
  }

  await mkdir(dirname(resolved.absolute), { recursive: true });
  await writeFile(resolved.absolute, input.content, 'utf8');

  emitToolCall(ctx, {
    tool: 'write_file',
    input: { path: resolved.relative, created },
    status: 'ok',
  });
  return { path: resolved.relative, bytesWritten: Buffer.byteLength(input.content), created };
}

export interface EditFileResult {
  path: string;
  replacements: number;
}

/**
 * Replaces `oldString` with `newString`. Default semantics match native
 * Edit: oldString must occur exactly once (so the edit is unambiguous);
 * `replaceAll: true` lifts that constraint. Zero matches throws so the
 * agent surfaces stale plans rather than silently no-opping.
 */
export async function editFileTool(
  ctx: FactoryContext,
  input: z.infer<typeof EditFileInput>,
): Promise<EditFileResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'edit_file', err, { ...input });
    throw err;
  }

  const original = await readFile(resolved.absolute, 'utf8');
  const replaceAll = input.replaceAll === true;

  let next: string;
  let replacements: number;
  if (replaceAll) {
    const parts = original.split(input.oldString);
    replacements = parts.length - 1;
    next = parts.join(input.newString);
  } else {
    const firstIdx = original.indexOf(input.oldString);
    if (firstIdx === -1) {
      throw new EditMatchError(0, `edit_file: oldString not found in ${resolved.relative}`);
    }
    const secondIdx = original.indexOf(input.oldString, firstIdx + input.oldString.length);
    if (secondIdx !== -1) {
      throw new EditMatchError(
        2,
        `edit_file: oldString matches more than once in ${resolved.relative}; pass replaceAll:true or pick a unique fragment.`,
      );
    }
    replacements = 1;
    next =
      original.slice(0, firstIdx) +
      input.newString +
      original.slice(firstIdx + input.oldString.length);
  }

  if (replacements === 0) {
    throw new EditMatchError(0, `edit_file: oldString not found in ${resolved.relative}`);
  }

  await writeFile(resolved.absolute, next, 'utf8');

  emitToolCall(ctx, {
    tool: 'edit_file',
    input: { path: resolved.relative, replaceAll, replacements },
    status: 'ok',
  });
  return { path: resolved.relative, replacements };
}

export interface ApplyPatchResult {
  applied: boolean;
  filesChanged: string[];
}

/**
 * Applies a unified diff via `git apply`. The patch is written to a
 * Factory-owned tmp file outside the workspace (the path policy applies to
 * agent-supplied paths, not orchestrator internals) and removed in the
 * `finally`. `git apply` refuses patches that touch paths outside the
 * working tree, layering on top of the path policy.
 */
export async function applyPatchTool(
  ctx: FactoryContext,
  input: z.infer<typeof ApplyPatchInput>,
): Promise<ApplyPatchResult> {
  // The agent-supplied `path` arg is reserved for a future "patch this
  // specific file" semantic. Today we always invoke `git apply` from the
  // worktree root with the patch on disk; we still resolve `path` to
  // surface policy violations early and to enforce the workspace boundary
  // even though `git apply` would also refuse out-of-tree edits.
  try {
    resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'apply_patch', err, { path: input.path });
    throw err;
  }

  const patchFile = join(tmpdir(), `factory-patch-${randomUUID()}.patch`);
  await writeFile(patchFile, input.patch, 'utf8');

  try {
    const result = await runCommand({
      command: 'git',
      args: ['apply', '--whitespace=nowarn', patchFile],
      cwd: ctx.workspaceRoot,
      timeoutMs: APPLY_PATCH_TIMEOUT_MS,
      env: minimalEnv(),
    });

    if (result.status !== 'ok') {
      throw new ApplyPatchError(
        result.exitCode,
        result.stderr,
        `git apply failed (exit ${result.exitCode ?? 'null'}): ${result.stderr.trim()}`,
      );
    }

    // `git apply --numstat` returns the same shape git uses internally —
    // run it against the same patch file for a structured filesChanged list.
    const statResult = await runCommand({
      command: 'git',
      args: ['apply', '--numstat', '--summary', patchFile],
      cwd: ctx.workspaceRoot,
      timeoutMs: APPLY_PATCH_TIMEOUT_MS,
      env: minimalEnv(),
    });
    const filesChanged = parseNumstat(statResult.stdout);

    emitToolCall(ctx, {
      tool: 'apply_patch',
      input: { fileCount: filesChanged.length },
      status: 'ok',
      durationMs: result.durationMs,
    });
    return { applied: true, filesChanged };
  } finally {
    await unlink(patchFile).catch(() => undefined);
  }
}

function parseNumstat(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split('\n')) {
    // numstat lines: "<added>\t<removed>\t<path>"; summary lines start with " "
    const cols = line.split('\t');
    if (cols.length === 3 && cols[2].length > 0 && /^\d+|-$/.test(cols[0])) {
      out.push(cols[2]);
    }
  }
  return out;
}

export interface CreateDirectoryResult {
  path: string;
  created: boolean;
}

export async function createDirectoryTool(
  ctx: FactoryContext,
  input: z.infer<typeof CreateDirectoryInput>,
): Promise<CreateDirectoryResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation)
      handleBlocked(ctx, 'create_directory', err, { ...input });
    throw err;
  }

  let existed = false;
  try {
    const s = await stat(resolved.absolute);
    existed = s.isDirectory();
  } catch {
    existed = false;
  }

  await mkdir(resolved.absolute, { recursive: true });

  emitToolCall(ctx, {
    tool: 'create_directory',
    input: { path: resolved.relative },
    status: 'ok',
  });
  return { path: resolved.relative, created: !existed };
}

export interface MoveFileResult {
  from: string;
  to: string;
}

export async function moveFileTool(
  ctx: FactoryContext,
  input: z.infer<typeof MoveFileInput>,
): Promise<MoveFileResult> {
  let fromResolved: ReturnType<typeof resolveWorkspacePath>;
  let toResolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    fromResolved = resolveWorkspacePath(ctx.workspaceRoot, input.from);
    toResolved = resolveWorkspacePath(ctx.workspaceRoot, input.to);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'move_file', err, { ...input });
    throw err;
  }

  await mkdir(dirname(toResolved.absolute), { recursive: true });
  await rename(fromResolved.absolute, toResolved.absolute);

  emitToolCall(ctx, {
    tool: 'move_file',
    input: { from: fromResolved.relative, to: toResolved.relative },
    status: 'ok',
  });
  return { from: fromResolved.relative, to: toResolved.relative };
}

export interface DeleteFileResult {
  path: string;
  deleted: boolean;
}

/**
 * Deletes a single file. Directories are rejected — agents that need to
 * remove a tree should use `move_file` to a `.trash/` path the workflow
 * owns, or open a workflow-managed cleanup ticket. This narrows blast
 * radius from accidental recursive deletes.
 */
export async function deleteFileTool(
  ctx: FactoryContext,
  input: z.infer<typeof DeleteFileInput>,
): Promise<DeleteFileResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'delete_file', err, { ...input });
    throw err;
  }

  let existed = false;
  try {
    const s = await stat(resolved.absolute);
    if (s.isDirectory()) {
      throw new DeleteKindError(
        `delete_file refuses directories: ${resolved.relative}. Move it to a workflow-owned trash path instead.`,
      );
    }
    existed = true;
  } catch (err) {
    if (err instanceof DeleteKindError) throw err;
    existed = false;
  }

  if (existed) await rm(resolved.absolute, { force: true });

  emitToolCall(ctx, {
    tool: 'delete_file',
    input: { path: resolved.relative },
    status: 'ok',
  });
  return { path: resolved.relative, deleted: existed };
}
