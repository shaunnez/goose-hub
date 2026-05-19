import { spawn } from 'node:child_process';
import { readFile as fsReadFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type RepoRelativePath, canonicalizeFactoryToolPath } from '../path-contract.js';

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
  /** Repo-relative, package-relative, or absolute-in-worktree path to read. */
  path: string;
}

export interface ReadFileResult {
  path: RepoRelativePath;
  content: string;
}

/**
 * Reads a file at `path` relative to `workspaceRoot`.
 *
 * Security constraints:
 * - `path` must be non-empty
 * - Absolute paths are allowed only when they are inside `workspaceRoot`
 * - Package-relative paths are normalized when uniquely resolvable
 * - Ambiguous package-relative paths and `../` traversal are rejected
 *
 * @throws {SandboxViolationError} if the resolved path would escape the workspace root.
 */
export async function readFile(params: ReadFileParams): Promise<string> {
  const result = await readFileWithMetadata(params);
  return result.content;
}

export async function readFileWithMetadata(params: ReadFileParams): Promise<ReadFileResult> {
  const { workspaceRoot, path } = params;

  if (path.length === 0) {
    throw new SandboxViolationError('path must not be empty');
  }

  const canonical = canonicalizeFactoryToolPath({ rawPath: path, worktreePath: workspaceRoot });
  if (!canonical.ok) {
    throw new SandboxViolationError(canonical.error.message);
  }

  const content = await fsReadFile(resolve(workspaceRoot, canonical.path.path), 'utf8');
  return { path: canonical.path, content };
}

interface SearchFilesParams {
  /** Absolute path to the workspace root. Ripgrep is constrained to this directory. */
  workspaceRoot: string;
  /** The search pattern (regex or literal). Must not be empty or contain `../`. */
  pattern: string;
  /** Optional glob pattern to restrict which files are searched (e.g. `*.ts`). */
  glob?: string;
}

export interface SearchFilesResult {
  stdout: string;
  paths: RepoRelativePath[];
}

function canonicalizeRipgrepOutput(workspaceRoot: string, stdout: string): SearchFilesResult {
  const paths = new Map<string, RepoRelativePath>();
  const lines = stdout.split(/\r?\n/);
  const canonicalLines = lines.map((line) => {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match == null) return line;
    const [, rawPath, lineNumber, rest] = match;
    if (rawPath == null || lineNumber == null || rest == null) return line;
    const canonical = canonicalizeFactoryToolPath({ rawPath, worktreePath: workspaceRoot });
    if (!canonical.ok) return line;
    paths.set(canonical.path.path, canonical.path);
    return `${canonical.path.path}:${lineNumber}:${rest}`;
  });

  return { stdout: canonicalLines.join('\n'), paths: [...paths.values()] };
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
  const result = await searchFilesWithMetadata(params);
  return result.stdout;
}

export async function searchFilesWithMetadata(
  params: SearchFilesParams,
): Promise<SearchFilesResult> {
  const { workspaceRoot, pattern, glob } = params;

  if (pattern.length === 0) {
    throw new SandboxViolationError('pattern must not be empty');
  }

  if (pattern.includes('../')) {
    throw new SandboxViolationError(
      `Pattern "${pattern}" contains path traversal sequence "../". This is not permitted.`,
    );
  }
  if (glob?.includes('../')) {
    throw new SandboxViolationError(
      `Glob "${glob}" contains path traversal sequence "../". This is not permitted.`,
    );
  }

  return new Promise<SearchFilesResult>((resolveSearch, reject) => {
    const args: string[] = ['--no-heading', '--with-filename', '--line-number'];

    if (glob != null && glob.length > 0) {
      args.push('--glob', glob);
    }

    // cwd pins the search to workspaceRoot. Search "." so ripgrep prints relative paths.
    args.push(pattern, '.');

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
        resolveSearch(canonicalizeRipgrepOutput(workspaceRoot, stdout));
      } else if (code === 1) {
        // No matches — not an error.
        resolveSearch({ stdout: '', paths: [] });
      } else {
        reject(new Error(`ripgrep exited with code ${code}: ${stderr.trim()}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ripgrep: ${err.message}`));
    });
  });
}
