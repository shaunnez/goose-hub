import { writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type RepoRelativePath, canonicalizeFactoryToolPath } from '../path-contract.js';
import { SandboxViolationError } from './read.js';

interface WriteFileParams {
  /** Absolute path to the workspace root (the git worktree directory). */
  workspaceRoot: string;
  /** Repo-relative, package-relative, or absolute-in-worktree path to write. */
  path: string;
  /** UTF-8 file contents to write. */
  content: string;
  /** When true, parent directories are created as needed. Defaults to true. */
  createParents?: boolean;
}

export interface WriteFileResult {
  path: RepoRelativePath;
  written: true;
}

/**
 * Writes UTF-8 `content` to `path` relative to `workspaceRoot`.
 *
 * Security constraints (mirrors `readFile`):
 * - `path` must be non-empty
 * - Absolute paths are allowed only when they are inside `workspaceRoot`
 * - Package-relative paths are normalized when uniquely resolvable
 * - Ambiguous package-relative paths and `../` traversal are rejected
 *
 * Side effects:
 * - Parent directories are created when `createParents` is true (default).
 * - Files are overwritten if they already exist.
 *
 * @throws {SandboxViolationError} if the resolved path would escape the workspace root.
 */
export async function writeFile(params: WriteFileParams): Promise<void> {
  await writeFileWithMetadata(params);
}

export async function writeFileWithMetadata(params: WriteFileParams): Promise<WriteFileResult> {
  const { workspaceRoot, path, content, createParents = true } = params;

  if (path.length === 0) {
    throw new SandboxViolationError('path must not be empty');
  }

  const canonical = canonicalizeFactoryToolPath({ rawPath: path, worktreePath: workspaceRoot });
  if (!canonical.ok) {
    throw new SandboxViolationError(canonical.error.message);
  }

  const resolved = resolve(workspaceRoot, canonical.path.path);
  if (createParents) {
    await mkdir(dirname(resolved), { recursive: true });
  }

  await fsWriteFile(resolved, content, 'utf8');
  return { path: canonical.path, written: true };
}
