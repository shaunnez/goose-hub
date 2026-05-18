import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { GIT_ENV } from './git-env.js';

const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');

/**
 * Resolves the scratch worktree path for a given (runId, wpId) pair.
 * Pattern: ~/.factory/workspaces/<runId>:wp:<wpId>/
 *
 * The colon-separated compound key makes it immediately clear from the filesystem
 * which run and WP a worktree belongs to.
 */
export function wpWorktreePath(runId: string, wpId: string): string {
  return join(WORKSPACES_DIR, `${runId}:wp:${wpId}`);
}

/**
 * Creates a git scratch worktree for a single Work Package builder.
 *
 * Uses `git worktree add --detach` so the WP's worktree has no tracking branch
 * and will not conflict with other concurrent WP worktrees in the same repo.
 *
 * @param repo   - Absolute path to the local git repository (already cloned).
 * @param runId  - Canonical workflow isolation key (ULID/UUID).
 * @param wpId   - Work Package identifier (e.g. "WP1").
 * @returns The absolute path to the created scratch worktree.
 */
export function createWpScratchWorktree(
  repo: string,
  runId: string,
  wpId: string,
  baseRef?: string,
): string {
  const wtPath = wpWorktreePath(runId, wpId);
  mkdirSync(WORKSPACES_DIR, { recursive: true });
  const args = ['worktree', 'add', '--detach', wtPath];
  if (baseRef != null && baseRef.length > 0) args.push(baseRef);
  execFileSync('git', args, {
    cwd: repo,
    stdio: 'pipe',
    env: GIT_ENV,
  });
  return wtPath;
}

/**
 * Removes the git scratch worktree for a given (runId, wpId) pair.
 * Idempotent: no-ops when the worktree path does not exist.
 */
export function cleanupWpWorktree(runId: string, wpId: string): void {
  const wtPath = wpWorktreePath(runId, wpId);
  if (!existsSync(wtPath)) return;
  try {
    execFileSync('git', ['worktree', 'remove', '--force', wtPath], {
      cwd: wtPath,
      stdio: 'pipe',
      env: GIT_ENV,
    });
  } catch {
    // Fall through — forcibly remove below.
  }
  rmSync(wtPath, { recursive: true, force: true });
}

/**
 * Removes all WP scratch worktrees created for a given runId.
 * Called by the orchestrator in its finally block on both success and failure paths.
 */
export function cleanupAllWpWorktrees(runId: string, wpIds: string[]): void {
  for (const wpId of wpIds) {
    cleanupWpWorktree(runId, wpId);
  }
}

/**
 * Stages the WP's owned files and creates a commit in the scratch worktree.
 *
 * The orchestrator calls this after a WP builder returns successfully.
 * The commit message encodes the WP identity for audit purposes.
 *
 * @param worktreePath - Absolute path to the WP's scratch worktree.
 * @param filesOwned   - Workspace-relative paths owned by this WP.
 * @param commitMsg    - Commit message (e.g. "M19:WP1 Add DB schema").
 * @returns The resulting commit SHA (40 chars).
 */
export function orchestratorCommitWp(
  worktreePath: string,
  filesOwned: string[],
  commitMsg: string,
): string {
  execFileSync('git', ['add', '--', ...filesOwned], {
    cwd: worktreePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });
  execFileSync('git', ['commit', '-m', commitMsg], {
    cwd: worktreePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
}

/**
 * Stages ALL changes in the worktree and creates a commit.
 *
 * Used by the fix-issue (single-builder) orchestrator to commit the implement
 * skill's output before calling openPR. Replaces the previous pattern where
 * the implement skill committed its own work (ADR 0031).
 *
 * @param worktreePath - Absolute path to the worktree.
 * @param commitMsg    - Commit message.
 * @returns The resulting commit SHA (40 chars).
 */
export function orchestratorCommitAll(worktreePath: string, commitMsg: string): string {
  execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe', env: GIT_ENV });
  execFileSync('git', ['commit', '--allow-empty', '-m', commitMsg], {
    cwd: worktreePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
}

/**
 * Reverts a WP builder's file changes in the scratch worktree.
 *
 * Called when a WP fails so its partial work does not pollute the next
 * iteration's starting state. Only reverts files in `filesOwned`; other
 * files in the worktree (if any leaked through the guard) are left alone
 * so the violation is visible in the event stream.
 *
 * @param worktreePath - Absolute path to the WP's scratch worktree.
 * @param filesOwned   - Workspace-relative paths to revert.
 */
export function revertWpChanges(worktreePath: string, filesOwned: string[]): void {
  for (const file of filesOwned) {
    try {
      execFileSync('git', ['checkout', '--', file], {
        cwd: worktreePath,
        stdio: 'pipe',
        env: GIT_ENV,
      });
    } catch {
      // `git checkout --` fails for untracked files (never staged). Remove them
      // so they don't leak into subsequent retry iterations in the same worktree.
      try {
        rmSync(resolve(worktreePath, file), { force: true });
      } catch {
        // File doesn't exist at all — not an error.
      }
    }
  }
}
