import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { z } from 'zod';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import { DEFAULT_STDOUT_LIMIT_BYTES, minimalEnv, runCommand } from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import type {
  FileExistsInput,
  FileInfoInput,
  ListDirInput,
  ListFilesInput,
  ReadFileInput,
  ReadManyFilesInput,
  SearchTextInput,
} from '../schemas.js';

const READ_FILE_CAP_BYTES = 256 * 1024;
const READ_FILE_DEFAULT_LINE_COUNT = 2000;
const LIST_DIR_CAP_ENTRIES = 500;
const LIST_FILES_CAP = 500;
const SEARCH_MAX_MATCHES = 200;
const SEARCH_TIMEOUT_MS = 15_000;
const LIST_FILES_TIMEOUT_MS = 10_000;

export type FileKind = 'file' | 'dir' | 'symlink' | 'other';

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
  startLine: number;
  endLine: number;
  totalLines: number;
}

export interface ReadManyFilesResult {
  files: Array<{ path: string; content: string; truncated: boolean }>;
  errors: Array<{ path: string; reason: string }>;
}

export interface ListDirEntry {
  name: string;
  kind: FileKind;
}

export interface ListDirResult {
  path: string;
  entries: ListDirEntry[];
  truncated: boolean;
}

export interface ListFilesResult {
  files: string[];
  truncated: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchTextResult {
  matches: SearchMatch[];
  truncated: boolean;
}

export interface FileInfoResult {
  path: string;
  exists: boolean;
  kind: FileKind;
  sizeBytes: number;
  mtime: string;
  isSymlink: boolean;
}

function statKind(s: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FileKind {
  if (s.isSymbolicLink()) return 'symlink';
  if (s.isFile()) return 'file';
  if (s.isDirectory()) return 'dir';
  return 'other';
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
 * Reads a file's contents with a hard byte cap and an optional line slice.
 * The cap protects against runaway memory on accidental large reads (build
 * artefacts, lockfiles); the line slice lets agents page through long files
 * cheaply.
 */
export async function readFileTool(
  ctx: FactoryContext,
  input: z.infer<typeof ReadFileInput>,
): Promise<ReadFileResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'read_file', err, { ...input });
    throw err;
  }

  const buffer = await readFile(resolved.absolute);
  const totalBytes = buffer.byteLength;
  const truncatedByBytes = totalBytes > READ_FILE_CAP_BYTES;
  const slice = truncatedByBytes ? buffer.subarray(0, READ_FILE_CAP_BYTES) : buffer;
  const text = slice.toString('utf8');
  const allLines = text.split('\n');

  const startLine = input.startLine ?? 1;
  const lineCount = input.lineCount ?? READ_FILE_DEFAULT_LINE_COUNT;
  const startIndex = Math.max(0, startLine - 1);
  const endIndex = Math.min(allLines.length, startIndex + lineCount);
  const sliced = allLines.slice(startIndex, endIndex);

  const truncated = truncatedByBytes || endIndex < allLines.length;

  const result: ReadFileResult = {
    path: resolved.relative,
    content: sliced.join('\n'),
    truncated,
    startLine: startIndex + 1,
    endLine: startIndex + sliced.length,
    totalLines: allLines.length,
  };

  emitToolCall(ctx, {
    tool: 'read_file',
    input: { path: resolved.relative },
    status: 'ok',
    truncated,
  });
  return result;
}

/**
 * Reads several files in a single call. Per-file errors (missing path,
 * policy violation) are reported in the `errors` array rather than aborting
 * the batch; this lets agents resolve a working set in one round-trip.
 */
export async function readManyFilesTool(
  ctx: FactoryContext,
  input: z.infer<typeof ReadManyFilesInput>,
): Promise<ReadManyFilesResult> {
  const files: ReadManyFilesResult['files'] = [];
  const errors: ReadManyFilesResult['errors'] = [];

  for (const path of input.paths) {
    try {
      const r = await readFileTool(ctx, { path });
      files.push({ path: r.path, content: r.content, truncated: r.truncated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'read failed';
      errors.push({ path, reason: message });
    }
  }

  emitToolCall(ctx, {
    tool: 'read_many_files',
    input: { count: input.paths.length },
    status: 'ok',
  });
  return { files, errors };
}

/**
 * Lists immediate (or shallow-nested) entries of a directory. `depth` > 1
 * recurses but the entry-count cap still applies, so deep trees truncate.
 */
export async function listDirTool(
  ctx: FactoryContext,
  input: z.infer<typeof ListDirInput>,
): Promise<ListDirResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'list_dir', err, { ...input });
    throw err;
  }

  const depth = input.depth ?? 1;
  const entries: ListDirEntry[] = [];
  let truncated = false;

  async function walk(
    absolute: string,
    relativePath: string,
    remainingDepth: number,
  ): Promise<void> {
    if (entries.length >= LIST_DIR_CAP_ENTRIES) {
      truncated = true;
      return;
    }
    const dirents = await readdir(absolute, { withFileTypes: true });
    for (const dirent of dirents) {
      if (entries.length >= LIST_DIR_CAP_ENTRIES) {
        truncated = true;
        return;
      }
      const kind = dirent.isSymbolicLink()
        ? 'symlink'
        : dirent.isFile()
          ? 'file'
          : dirent.isDirectory()
            ? 'dir'
            : 'other';
      const name = relativePath === '' ? dirent.name : `${relativePath}/${dirent.name}`;
      entries.push({ name, kind });
      if (kind === 'dir' && remainingDepth > 1) {
        await walk(join(absolute, dirent.name), name, remainingDepth - 1);
      }
    }
  }

  await walk(resolved.absolute, '', depth);

  emitToolCall(ctx, {
    tool: 'list_dir',
    input: { path: resolved.relative, depth },
    status: 'ok',
    truncated,
  });
  return { path: resolved.relative, entries, truncated };
}

/**
 * Lists files matching an optional glob (delegated to ripgrep, which
 * respects .gitignore by default). Output is capped to avoid huge listings.
 */
export async function listFilesTool(
  ctx: FactoryContext,
  input: z.infer<typeof ListFilesInput>,
): Promise<ListFilesResult> {
  const args: string[] = ['--files'];
  if (input.glob != null) args.push('--glob', input.glob);

  let searchPath = '.';
  if (input.path != null) {
    try {
      searchPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).relative || '.';
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'list_files', err, { ...input });
      throw err;
    }
  }
  args.push(searchPath);

  const limit = Math.min(input.limit ?? LIST_FILES_CAP, LIST_FILES_CAP);

  const result = await runCommand({
    command: 'rg',
    args,
    cwd: ctx.workspaceRoot,
    timeoutMs: LIST_FILES_TIMEOUT_MS,
    env: minimalEnv(),
  });

  const lines = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const truncated = result.truncated || lines.length > limit;
  const files = lines.slice(0, limit);

  emitToolCall(ctx, {
    tool: 'list_files',
    input: { path: searchPath, glob: input.glob ?? null },
    status: result.status,
    durationMs: result.durationMs,
    truncated,
  });
  return { files, truncated };
}

/**
 * Full-text search via ripgrep. The query is passed as a positional argv
 * (no shell expansion); path/glob filter narrows the search. Output is
 * parsed into structured `{path, line, text}` matches to keep the agent
 * out of the raw rg format.
 */
export async function searchTextTool(
  ctx: FactoryContext,
  input: z.infer<typeof SearchTextInput>,
): Promise<SearchTextResult> {
  const args: string[] = [
    '--no-heading',
    '--with-filename',
    '--line-number',
    '--max-count',
    String(SEARCH_MAX_MATCHES),
    '--max-columns',
    '300',
  ];
  if (input.contextLines != null && input.contextLines > 0) {
    args.push('--context', String(input.contextLines));
  }
  if (input.glob != null) args.push('--glob', input.glob);

  let searchPath = '.';
  if (input.path != null) {
    try {
      searchPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).relative || '.';
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'search_text', err, { ...input });
      throw err;
    }
  }
  args.push('--', input.query, searchPath);

  const result = await runCommand({
    command: 'rg',
    args,
    cwd: ctx.workspaceRoot,
    timeoutMs: SEARCH_TIMEOUT_MS,
    stdoutLimitBytes: DEFAULT_STDOUT_LIMIT_BYTES,
    env: minimalEnv(),
  });

  const limit = Math.min(input.maxMatches ?? SEARCH_MAX_MATCHES, SEARCH_MAX_MATCHES);
  const matches: SearchMatch[] = [];

  for (const line of result.stdout.split('\n')) {
    if (matches.length >= limit) break;
    if (line.length === 0) continue;
    // rg format: `<path>:<line>:<text>`. Path can contain colons on Windows
    // but the worktree is POSIX in practice. Split on the first two colons
    // only so the text payload preserves any colons it contains.
    const firstColon = line.indexOf(':');
    if (firstColon === -1) continue;
    const secondColon = line.indexOf(':', firstColon + 1);
    if (secondColon === -1) continue;
    const path = line.slice(0, firstColon);
    const lineNum = Number.parseInt(line.slice(firstColon + 1, secondColon), 10);
    const text = line.slice(secondColon + 1);
    if (!Number.isFinite(lineNum)) continue;
    matches.push({ path, line: lineNum, text });
  }

  const truncated = result.truncated || matches.length >= limit;

  emitToolCall(ctx, {
    tool: 'search_text',
    input: { query: input.query, path: searchPath, glob: input.glob ?? null },
    status: result.status,
    durationMs: result.durationMs,
    truncated,
  });
  return { matches, truncated };
}

/**
 * Cheap existence check — no read, no audit-event side-effects beyond the
 * tool-call audit itself. Useful before write_file to decide create vs.
 * overwrite semantics.
 */
export async function fileExistsTool(
  ctx: FactoryContext,
  input: z.infer<typeof FileExistsInput>,
): Promise<{ path: string; exists: boolean }> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'file_exists', err, { ...input });
    throw err;
  }

  let exists = false;
  try {
    await stat(resolved.absolute);
    exists = true;
  } catch {
    exists = false;
  }

  emitToolCall(ctx, {
    tool: 'file_exists',
    input: { path: resolved.relative },
    status: 'ok',
  });
  return { path: resolved.relative, exists };
}

/**
 * Returns size, kind, mtime for a single path. Reports `exists: false` for
 * missing paths rather than throwing — the typical caller wants to decide
 * what to do next.
 */
export async function fileInfoTool(
  ctx: FactoryContext,
  input: z.infer<typeof FileInfoInput>,
): Promise<FileInfoResult> {
  let resolved: ReturnType<typeof resolveWorkspacePath>;
  try {
    resolved = resolveWorkspacePath(ctx.workspaceRoot, input.path);
  } catch (err) {
    if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'file_info', err, { ...input });
    throw err;
  }

  let result: FileInfoResult;
  try {
    const s = await stat(resolved.absolute);
    result = {
      path: resolved.relative,
      exists: true,
      kind: statKind(s),
      sizeBytes: s.size,
      mtime: s.mtime.toISOString(),
      isSymlink: s.isSymbolicLink(),
    };
  } catch {
    result = {
      path: resolved.relative,
      exists: false,
      kind: 'other',
      sizeBytes: 0,
      mtime: new Date(0).toISOString(),
      isSymlink: false,
    };
  }

  emitToolCall(ctx, {
    tool: 'file_info',
    input: { path: resolved.relative },
    status: 'ok',
  });
  return result;
}

// Re-exports for testing — keep internal but addressable.
export const __internal = { READ_FILE_CAP_BYTES, LIST_DIR_CAP_ENTRIES, sep, relative };
