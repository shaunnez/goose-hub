import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import type { RepoRelativePath } from '../../path-contract.js';
import { canonicalizeFactoryToolPath } from '../../path-contract.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import {
  type CommandResult,
  type CommandStatus,
  DEFAULT_STDOUT_LIMIT_BYTES,
  minimalEnv,
  runCommand,
} from '../command-policy.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import { getCachedRunResult, normalizeRunCacheKey, setCachedRunResult } from '../run-cache.js';
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

const FALLBACK_SKIP_DIRS = new Set([
  '.codex',
  '.factory',
  '.git',
  '.hg',
  '.svn',
  '.agents',
  '.claude',
  'node_modules',
]);

export type FileKind = 'file' | 'dir' | 'symlink' | 'other';

export interface ReadFileResult {
  path: RepoRelativePath;
  content: string;
  truncated: boolean;
  startLine: number;
  endLine: number;
  totalLines: number;
  cached?: true;
}

export interface ReadManyFilesResult {
  files: Array<{ path: RepoRelativePath; content: string; truncated: boolean }>;
  errors: Array<{ path: string; reason: string }>;
  cached?: true;
}

export interface ListDirEntry {
  name: RepoRelativePath;
  kind: FileKind;
}

export interface ListDirResult {
  path: RepoRelativePath;
  entries: ListDirEntry[];
  truncated: boolean;
  cached?: true;
}

export interface ListFilesResult {
  files: RepoRelativePath[];
  truncated: boolean;
  cached?: true;
}

export interface SearchMatch {
  path: RepoRelativePath;
  line: number;
  text: string;
}

export interface SearchTextResult {
  matches: SearchMatch[];
  truncated: boolean;
  cached?: true;
}

export interface FileInfoResult {
  path: RepoRelativePath;
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

function rawPathToCanonical(rawPath: string, workspaceRoot: string): RepoRelativePath {
  const result = canonicalizeFactoryToolPath({ rawPath, worktreePath: workspaceRoot });
  return result.ok ? result.path : { path: rawPath, root: 'worktree' };
}

function rgAuditStatus(result: CommandResult): CommandStatus {
  if (result.status === 'failed' && result.exitCode === 1) return 'ok';
  return result.status;
}

function rgNoMatches(result: CommandResult): boolean {
  return result.status === 'failed' && result.exitCode === 1;
}

function rgSpawnFailed(result: CommandResult): boolean {
  return result.status === 'failed' && result.exitCode == null;
}

function globToRegExp(glob: string): RegExp {
  let source = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '.*';
      }
      continue;
    }
    if (char === '?') {
      source += '.';
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  source += '$';
  return new RegExp(source);
}

function matchesOptionalGlob(path: string, glob: string | undefined): boolean {
  if (glob == null || glob.trim().length === 0) return true;
  const matcher = globToRegExp(glob);
  return matcher.test(path);
}

async function walkFilePaths(input: {
  workspaceRoot: string;
  searchPath: string;
  limit: number;
  glob?: string;
}): Promise<{ files: RepoRelativePath[]; truncated: boolean }> {
  const files: RepoRelativePath[] = [];
  let truncated = false;

  async function walk(repoRelativeDir: string): Promise<void> {
    if (files.length >= input.limit) {
      truncated = true;
      return;
    }

    const absoluteDir =
      repoRelativeDir.length === 0
        ? input.workspaceRoot
        : join(input.workspaceRoot, repoRelativeDir);
    const dirents = await readdir(absoluteDir, { withFileTypes: true });

    for (const dirent of dirents) {
      if (files.length >= input.limit) {
        truncated = true;
        return;
      }
      if (dirent.isDirectory() && FALLBACK_SKIP_DIRS.has(dirent.name)) continue;

      const repoRelativePath =
        repoRelativeDir.length === 0 ? dirent.name : `${repoRelativeDir}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await walk(repoRelativePath);
        continue;
      }
      if (!dirent.isFile() || !matchesOptionalGlob(repoRelativePath, input.glob)) continue;
      files.push(rawPathToCanonical(repoRelativePath, input.workspaceRoot));
    }
  }

  await walk(input.searchPath === '.' ? '' : input.searchPath);
  return { files, truncated };
}

function queryToRegExp(query: string): RegExp {
  try {
    return new RegExp(query);
  } catch {
    return new RegExp(query.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'));
  }
}

async function fallbackSearchText(input: {
  workspaceRoot: string;
  searchPath: string;
  query: string;
  limit: number;
  glob?: string;
}): Promise<SearchTextResult> {
  const matches: SearchMatch[] = [];
  const listing = await walkFilePaths({
    workspaceRoot: input.workspaceRoot,
    searchPath: input.searchPath,
    limit: Number.MAX_SAFE_INTEGER,
    glob: input.glob,
  });
  const query = queryToRegExp(input.query);

  for (const file of listing.files) {
    if (matches.length >= input.limit) break;
    let content: string;
    try {
      content = await readFile(join(input.workspaceRoot, file.path), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= input.limit) break;
      query.lastIndex = 0;
      if (!query.test(lines[index])) continue;
      matches.push({ path: file, line: index + 1, text: lines[index] });
    }
  }

  return { matches, truncated: listing.truncated || matches.length >= input.limit };
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

  const cacheKey = normalizeRunCacheKey({
    toolName: 'read_file',
    args: input,
    workspaceRoot: ctx.workspaceRoot,
  });
  const cached =
    cacheKey == null ? null : getCachedRunResult<ReadFileResult>(ctx.runId, cacheKey.key);
  if (cached != null) {
    const result = { ...cached, cached: true as const };
    emitToolCall(ctx, {
      tool: 'read_file',
      input: { path: input.path },
      status: 'ok',
      truncated: result.truncated,
      bytesRead: Buffer.byteLength(result.content, 'utf8'),
      cached: true,
    });
    return result;
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
    path: resolved.canonical,
    content: sliced.join('\n'),
    truncated,
    startLine: startIndex + 1,
    endLine: startIndex + sliced.length,
    totalLines: allLines.length,
  };

  emitToolCall(ctx, {
    tool: 'read_file',
    input: { path: input.path },
    status: 'ok',
    truncated,
    bytesRead: Buffer.byteLength(result.content, 'utf8'),
  });
  if (cacheKey != null) setCachedRunResult(ctx.runId, cacheKey, result);
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
  const cacheKey = normalizeRunCacheKey({
    toolName: 'read_many_files',
    args: input,
    workspaceRoot: ctx.workspaceRoot,
  });
  const cached =
    cacheKey == null ? null : getCachedRunResult<ReadManyFilesResult>(ctx.runId, cacheKey.key);
  if (cached != null) {
    emitToolCall(ctx, {
      tool: 'read_many_files',
      input: { count: input.paths.length },
      status: 'ok',
      cached: true,
    });
    return { ...cached, cached: true as const };
  }

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
  const result = { files, errors };
  if (cacheKey != null) setCachedRunResult(ctx.runId, cacheKey, result);
  return result;
}

/**
 * Lists immediate (or shallow-nested) entries of a directory. `depth` > 1
 * recurses but the entry-count cap still applies, so deep trees truncate.
 * Entry names are workspace-relative `RepoRelativePath` values.
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
  const cacheKey = normalizeRunCacheKey({
    toolName: 'list_dir',
    args: { ...input, depth },
    workspaceRoot: ctx.workspaceRoot,
  });
  const cached =
    cacheKey == null ? null : getCachedRunResult<ListDirResult>(ctx.runId, cacheKey.key);
  if (cached != null) {
    emitToolCall(ctx, {
      tool: 'list_dir',
      input: { path: input.path, depth },
      status: 'ok',
      truncated: cached.truncated,
      cached: true,
    });
    return { ...cached, cached: true as const };
  }

  const entries: ListDirEntry[] = [];
  let truncated = false;
  const dirWorkspacePath = resolved.canonical.path;

  async function walk(
    absolute: string,
    parentWorkspacePath: string,
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
      const entryPath = `${parentWorkspacePath}/${dirent.name}`;
      const name: RepoRelativePath = rawPathToCanonical(entryPath, ctx.workspaceRoot);
      entries.push({ name, kind });
      if (kind === 'dir' && remainingDepth > 1) {
        await walk(join(absolute, dirent.name), entryPath, remainingDepth - 1);
      }
    }
  }

  await walk(resolved.absolute, dirWorkspacePath, depth);

  emitToolCall(ctx, {
    tool: 'list_dir',
    input: { path: input.path, depth },
    status: 'ok',
    truncated,
  });
  const result = { path: resolved.canonical, entries, truncated };
  if (cacheKey != null) setCachedRunResult(ctx.runId, cacheKey, result);
  return result;
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
      searchPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).canonical.path || '.';
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'list_files', err, { ...input });
      throw err;
    }
  }
  args.push(searchPath);

  const limit = Math.min(input.limit ?? LIST_FILES_CAP, LIST_FILES_CAP);
  const cacheKey = normalizeRunCacheKey({
    toolName: 'list_files',
    args: { ...input, limit },
    workspaceRoot: ctx.workspaceRoot,
  });
  const cached =
    cacheKey == null ? null : getCachedRunResult<ListFilesResult>(ctx.runId, cacheKey.key);
  if (cached != null) {
    emitToolCall(ctx, {
      tool: 'list_files',
      input: { path: input.path ?? null, glob: input.glob ?? null },
      status: 'ok',
      truncated: cached.truncated,
      noMatches: cached.files.length === 0,
      cached: true,
    });
    return { ...cached, cached: true as const };
  }

  const result = await runCommand({
    command: 'rg',
    args,
    cwd: ctx.workspaceRoot,
    timeoutMs: LIST_FILES_TIMEOUT_MS,
    env: minimalEnv(),
  });

  let truncated: boolean;
  let files: RepoRelativePath[];

  if (rgSpawnFailed(result)) {
    const fallback = await walkFilePaths({
      workspaceRoot: ctx.workspaceRoot,
      searchPath,
      limit,
      glob: input.glob,
    });
    truncated = fallback.truncated;
    files = fallback.files;
  } else {
    const lines = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    truncated = result.truncated || lines.length > limit;
    const rawFiles = lines.slice(0, limit);
    files = rawFiles.map((rawPath) => rawPathToCanonical(rawPath, ctx.workspaceRoot));
  }

  emitToolCall(ctx, {
    tool: 'list_files',
    input: { path: input.path ?? null, glob: input.glob ?? null },
    status: rgSpawnFailed(result) ? 'ok' : rgAuditStatus(result),
    durationMs: result.durationMs,
    truncated,
    noMatches: files.length === 0 && (rgSpawnFailed(result) || rgNoMatches(result)),
  });
  const output = { files, truncated };
  if (cacheKey != null) setCachedRunResult(ctx.runId, cacheKey, output);
  return output;
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
      searchPath = resolveWorkspacePath(ctx.workspaceRoot, input.path).canonical.path || '.';
    } catch (err) {
      if (err instanceof PathPolicyViolation) handleBlocked(ctx, 'search_text', err, { ...input });
      throw err;
    }
  }
  args.push('--', input.query, searchPath);

  const limit = Math.min(input.maxMatches ?? SEARCH_MAX_MATCHES, SEARCH_MAX_MATCHES);
  const cacheKey = normalizeRunCacheKey({
    toolName: 'search_text',
    args: { ...input, maxMatches: limit },
    workspaceRoot: ctx.workspaceRoot,
  });
  const cached =
    cacheKey == null ? null : getCachedRunResult<SearchTextResult>(ctx.runId, cacheKey.key);
  if (cached != null) {
    emitToolCall(ctx, {
      tool: 'search_text',
      input: { query: input.query, path: input.path ?? null, glob: input.glob ?? null },
      status: 'ok',
      truncated: cached.truncated,
      noMatches: cached.matches.length === 0,
      cached: true,
    });
    return { ...cached, cached: true as const };
  }

  const result = await runCommand({
    command: 'rg',
    args,
    cwd: ctx.workspaceRoot,
    timeoutMs: SEARCH_TIMEOUT_MS,
    stdoutLimitBytes: DEFAULT_STDOUT_LIMIT_BYTES,
    env: minimalEnv(),
  });

  let matches: SearchMatch[];
  let truncated: boolean;

  if (rgSpawnFailed(result)) {
    const fallback = await fallbackSearchText({
      workspaceRoot: ctx.workspaceRoot,
      searchPath,
      query: input.query,
      limit,
      glob: input.glob,
    });
    matches = fallback.matches;
    truncated = fallback.truncated;
  } else {
    matches = [];
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
      const rawPath = line.slice(0, firstColon);
      const lineNum = Number.parseInt(line.slice(firstColon + 1, secondColon), 10);
      const text = line.slice(secondColon + 1);
      if (!Number.isFinite(lineNum)) continue;
      matches.push({ path: rawPathToCanonical(rawPath, ctx.workspaceRoot), line: lineNum, text });
    }

    truncated = result.truncated || matches.length >= limit;
  }

  emitToolCall(ctx, {
    tool: 'search_text',
    input: { query: input.query, path: input.path ?? null, glob: input.glob ?? null },
    status: rgSpawnFailed(result) ? 'ok' : rgAuditStatus(result),
    durationMs: result.durationMs,
    truncated,
    noMatches: matches.length === 0 && (rgSpawnFailed(result) || rgNoMatches(result)),
  });
  const output = { matches, truncated };
  if (cacheKey != null) setCachedRunResult(ctx.runId, cacheKey, output);
  return output;
}

/**
 * Cheap existence check — no read, no audit-event side-effects beyond the
 * tool-call audit itself. Useful before write_file to decide create vs.
 * overwrite semantics.
 */
export async function fileExistsTool(
  ctx: FactoryContext,
  input: z.infer<typeof FileExistsInput>,
): Promise<{ path: RepoRelativePath; exists: boolean }> {
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
    input: { path: input.path },
    status: 'ok',
  });
  return { path: resolved.canonical, exists };
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
      path: resolved.canonical,
      exists: true,
      kind: statKind(s),
      sizeBytes: s.size,
      mtime: s.mtime.toISOString(),
      isSymlink: s.isSymbolicLink(),
    };
  } catch {
    result = {
      path: resolved.canonical,
      exists: false,
      kind: 'other',
      sizeBytes: 0,
      mtime: new Date(0).toISOString(),
      isSymlink: false,
    };
  }

  emitToolCall(ctx, {
    tool: 'file_info',
    input: { path: input.path },
    status: 'ok',
  });
  return result;
}

// Re-exports for testing — keep internal but addressable.
export const __internal = { READ_FILE_CAP_BYTES, LIST_DIR_CAP_ENTRIES };
