import { spawn } from 'node:child_process';
import { readFile as fsReadFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Typed error thrown when a tool call attempts to escape the workspace root.
 * Callers should catch this specifically to distinguish from filesystem errors.
 */
export class SandboxViolationError extends Error {
  readonly kind = 'SandboxViolationError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SandboxViolationError';
  }
}

interface ReadFileParams {
  /** Absolute path to the workspace root (the git worktree directory). */
  workspaceRoot: string;
  /** Relative path to the file within the workspace. Must not be absolute or traverse above root. */
  path: string;
}

/**
 * Reads a file at `path` relative to `workspaceRoot`.
 *
 * Security constraints:
 * - `path` must be a non-empty relative path (no leading `/`)
 * - After resolution, the resulting absolute path must start with `workspaceRoot`
 *   (prevents `../` traversal)
 *
 * @throws {SandboxViolationError} if the resolved path would escape the workspace root.
 */
export async function readFile(params: ReadFileParams): Promise<string> {
  const { workspaceRoot, path } = params;

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

  return fsReadFile(resolved, 'utf8');
}

interface SearchFilesParams {
  /** Absolute path to the workspace root. Ripgrep is constrained to this directory. */
  workspaceRoot: string;
  /** The search pattern (regex or literal). Must not be empty or contain `../`. */
  pattern: string;
  /** Optional glob pattern to restrict which files are searched (e.g. `*.ts`). */
  glob?: string;
}

/**
 * Searches for `pattern` within `workspaceRoot` using ripgrep (`rg`).
 *
 * Security constraints:
 * - `pattern` must be non-empty
 * - `pattern` must not contain `../` to prevent path-escape attempts
 * - Ripgrep is always invoked with `workspaceRoot` as the search path (never user-supplied)
 *
 * Returns the combined stdout of ripgrep, or `""` when there are no matches (exit code 1).
 *
 * @throws {SandboxViolationError} if the pattern fails validation.
 */
export async function searchFiles(params: SearchFilesParams): Promise<string> {
  const { workspaceRoot, pattern, glob } = params;

  if (pattern.length === 0) {
    throw new SandboxViolationError('pattern must not be empty');
  }

  if (pattern.includes('../')) {
    throw new SandboxViolationError(
      `Pattern "${pattern}" contains path traversal sequence "../". This is not permitted.`,
    );
  }

  return new Promise<string>((resolve, reject) => {
    const args: string[] = ['--no-heading', '--with-filename', '--line-number'];

    if (glob != null && glob.length > 0) {
      args.push('--glob', glob);
    }

    // Always pin the search path to workspaceRoot — never user-supplied.
    args.push(pattern, workspaceRoot);

    const child = spawn('rg', args, {
      cwd: workspaceRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      // ripgrep exits with 0 on match, 1 on no match, 2+ on error.
      if (code === 0) {
        resolve(stdout);
      } else if (code === 1) {
        // No matches — not an error.
        resolve('');
      } else {
        reject(new Error(`ripgrep exited with code ${code}: ${stderr.trim()}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ripgrep: ${err.message}`));
    });
  });
}
