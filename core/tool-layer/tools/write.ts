import { writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { SandboxViolationError } from './read.js';

interface WriteFileParams {
  /** Absolute path to the workspace root (the git worktree directory). */
  workspaceRoot: string;
  /** Relative path to the file within the workspace. Must not be absolute or traverse above root. */
  path: string;
  /** UTF-8 file contents to write. */
  content: string;
  /** When true, parent directories are created as needed. Defaults to true. */
  createParents?: boolean;
}

/**
 * Writes UTF-8 `content` to `path` relative to `workspaceRoot`.
 *
 * Security constraints (mirrors `readFile`):
 * - `path` must be a non-empty relative path (no leading `/`)
 * - After resolution, the resulting absolute path must start with `workspaceRoot`
 *   (prevents `../` traversal)
 *
 * Side effects:
 * - Parent directories are created when `createParents` is true (default).
 * - Files are overwritten if they already exist.
 *
 * @throws {SandboxViolationError} if the resolved path would escape the workspace root.
 */
export async function writeFile(params: WriteFileParams): Promise<void> {
  const { workspaceRoot, path, content, createParents = true } = params;

  if (path.length === 0) {
    throw new SandboxViolationError('path must not be empty');
  }

  if (isAbsolute(path)) {
    throw new SandboxViolationError(
      `Absolute paths are not permitted: "${path}". Use a path relative to the workspace root.`,
    );
  }

  const resolved = resolve(workspaceRoot, path);
  const rootNormalized = resolve(workspaceRoot);

  if (!resolved.startsWith(`${rootNormalized}${sep}`) && resolved !== rootNormalized) {
    throw new SandboxViolationError(
      `Path traversal detected: "${path}" resolves outside workspace root "${workspaceRoot}".`,
    );
  }

  if (createParents) {
    await mkdir(dirname(resolved), { recursive: true });
  }

  await fsWriteFile(resolved, content, 'utf8');
}
