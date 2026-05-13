import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GIT_ENV } from './git-env.js';

const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const CLONES_DIR = join(homedir(), '.factory', 'clones');

/** SSH clone URL pattern, e.g. `git@bitbucket.org:workspace/repo.git`. */
const SSH_PATTERN = /^([^@]+)@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/;
/** HTTPS clone URL pattern, e.g. `https://bitbucket.org/workspace/repo.git`. */
const HTTPS_PATTERN = /^https:\/\/(?:([^@]+)@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/;

export interface ParsedCloneUrl {
  scheme: 'ssh' | 'https';
  host: string;
  workspace: string;
  repoSlug: string;
  /** True when the host is recognised as Bitbucket Cloud. */
  isBitbucket: boolean;
}

/**
 * Parse an SSH or HTTPS git clone URL. Returns `null` if the URL is
 * neither — callers can use this to decide whether to treat the input
 * as a URL or as an existing local path.
 */
export function parseCloneUrl(url: string): ParsedCloneUrl | null {
  const ssh = url.match(SSH_PATTERN);
  if (ssh != null) {
    const [, , host, workspace, repoSlug] = ssh;
    return {
      scheme: 'ssh',
      host,
      workspace,
      repoSlug,
      isBitbucket: host === 'bitbucket.org',
    };
  }
  const https = url.match(HTTPS_PATTERN);
  if (https != null) {
    const [, , host, workspace, repoSlug] = https;
    return {
      scheme: 'https',
      host,
      workspace,
      repoSlug,
      isBitbucket: host === 'bitbucket.org',
    };
  }
  return null;
}

function bitbucketHttpsWithCreds(url: string): string {
  const user = process.env.BITBUCKET_USER;
  const appPassword = process.env.BITBUCKET_APP_PASSWORD;
  if (user == null || appPassword == null) return url;
  return url.replace(
    /^https:\/\/(?:[^@]+@)?bitbucket\.org\//,
    `https://${encodeURIComponent(user)}:${encodeURIComponent(appPassword)}@bitbucket.org/`,
  );
}

/**
 * Ensure a clone of the given URL exists locally at
 * `~/.factory/clones/<host>/<workspace>/<repoSlug>` and return its path.
 *
 * - SSH URLs are cloned as-is and rely on the agent host's SSH agent /
 *   key configuration to authenticate.
 * - HTTPS URLs are rewritten to include `BITBUCKET_APP_PASSWORD` for
 *   Bitbucket Cloud. Other hosts pass through unchanged (GitHub uses
 *   the same env-less HTTPS scheme as before).
 *
 * Subsequent calls with the same URL return the cached clone path
 * without re-fetching.
 */
export function ensureClonedRepo(cloneUrl: string): string {
  const parsed = parseCloneUrl(cloneUrl);
  if (parsed == null) {
    throw new Error(`Unrecognised clone URL: ${cloneUrl}`);
  }
  const target = join(CLONES_DIR, parsed.host, parsed.workspace, parsed.repoSlug);
  if (existsSync(target)) return target;

  mkdirSync(join(CLONES_DIR, parsed.host, parsed.workspace), { recursive: true });

  let urlForGit = cloneUrl;
  if (parsed.isBitbucket && parsed.scheme === 'https') {
    urlForGit = bitbucketHttpsWithCreds(cloneUrl);
  }

  execFileSync('git', ['clone', urlForGit, target], {
    stdio: 'pipe',
    env: GIT_ENV,
  });
  return target;
}

/**
 * Resolves the worktree path for a given runId.
 * Pattern: ~/.factory/workspaces/<runId>/
 */
function worktreePath(runId: string): string {
  return join(WORKSPACES_DIR, runId);
}

/**
 * Returns the worktree path for `runId` IF the directory exists on disk.
 * Used by tail workflows (audit, retro) that want to attach to the dev
 * worktree opportunistically without recreating it.
 */
export function existingWorktreePath(runId: string): string | null {
  const wtPath = worktreePath(runId);
  return existsSync(wtPath) ? wtPath : null;
}

/**
 * Creates a git worktree for the given repo at ~/.factory/workspaces/<runId>/.
 *
 * Uses `git worktree add --detach` to create a detached HEAD worktree,
 * which avoids branch conflicts when multiple runs use the same repo.
 *
 * Accepts either an absolute local path to a pre-cloned repository OR a
 * clone URL (SSH or HTTPS). When passed a clone URL, the repo is cloned
 * lazily into `~/.factory/clones/...` and the worktree is added from
 * there. Bitbucket HTTPS URLs are authenticated via the
 * `BITBUCKET_USER` / `BITBUCKET_APP_PASSWORD` env vars; SSH URLs rely on
 * the host's SSH key configuration.
 *
 * @param repoOrUrl - Absolute path to a local git repository, OR an SSH /
 *                    HTTPS clone URL.
 * @param runId - Canonical workflow isolation key (ULID/UUID).
 * @returns The absolute path to the created worktree.
 */
export function createWorktree(repoOrUrl: string, runId: string): string {
  const wtPath = worktreePath(runId);

  // Ensure the parent workspaces directory exists
  mkdirSync(WORKSPACES_DIR, { recursive: true });

  const repoPath = parseCloneUrl(repoOrUrl) != null ? ensureClonedRepo(repoOrUrl) : repoOrUrl;

  execFileSync('git', ['worktree', 'add', '--detach', wtPath], {
    cwd: repoPath,
    stdio: 'pipe',
    env: GIT_ENV,
  });

  return wtPath;
}

/**
 * Runs `pnpm install --frozen-lockfile` in the worktree to warm node_modules before the agent
 * starts. Eliminates the first wasted turn where the agent discovers and installs dependencies.
 *
 * @param worktreePath - Absolute path to the worktree directory.
 * @param filter - Optional pnpm workspace filter (e.g. `"./apps/web"`). When provided, only that
 *   package and its dependencies are installed.
 */
export function prewarmWorktree(worktreePath: string, filter?: string): void {
  const args = filter
    ? ['install', '--frozen-lockfile', '--filter', filter]
    : ['install', '--frozen-lockfile'];
  execFileSync('pnpm', args, {
    cwd: worktreePath,
    stdio: 'pipe',
  });
}

/**
 * Removes the git worktree for the given runId.
 *
 * Idempotent: if the worktree path does not exist, this is a no-op.
 * If `git worktree remove` fails (e.g. repo already gone), the directory
 * is still removed via rmSync with force.
 *
 * @param runId - Canonical workflow isolation key (ULID/UUID).
 */
export function cleanupWorktree(runId: string): void {
  const wtPath = worktreePath(runId);

  if (!existsSync(wtPath)) {
    return;
  }

  try {
    execFileSync('git', ['worktree', 'remove', '--force', wtPath], {
      cwd: wtPath,
      stdio: 'pipe',
      env: GIT_ENV,
    });
  } catch {
    // git worktree remove may fail if the git repo is gone or corrupted.
    // Fall through and forcibly remove the directory.
  }

  // Ensure directory is fully removed regardless of git outcome
  rmSync(wtPath, { recursive: true, force: true });
}
