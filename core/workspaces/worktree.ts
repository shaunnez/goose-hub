import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GIT_ENV } from './git-env.js';

const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');

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
 * @param repo - Absolute path to the local git repository (already cloned).
 * @param runId - Canonical workflow isolation key (ULID/UUID).
 * @returns The absolute path to the created worktree.
 */
export function createWorktree(repo: string, runId: string, baseRef?: string): string {
  const wtPath = worktreePath(runId);

  // Ensure the parent workspaces directory exists
  mkdirSync(WORKSPACES_DIR, { recursive: true });

  const args = ['worktree', 'add', '--detach', wtPath];
  if (baseRef != null && baseRef.length > 0) {
    args.push(baseRef);
  }

  execFileSync('git', args, {
    cwd: repo,
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
