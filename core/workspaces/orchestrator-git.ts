import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { GIT_ENV } from './git-env.js';
import { repoId } from './worktree.js';

const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');

/**
 * Resolves the scratch worktree path for a given (runId, wpId) pair.
 * Legacy pattern: ~/.factory/workspaces/<runId>__wp__<wpId>/
 * Repo-aware pattern: ~/.factory/workspaces/<runId>/<repoId>__wp__<wpId>/
 *
 * Avoid path delimiter characters because pnpm refuses to add node_modules/.bin
 * paths containing them to PATH when running package-scoped executables.
 */
export function wpWorktreePath(runId: string, wpId: string, repoRef?: string): string {
  if (repoRef != null && repoRef.length > 0) {
    return join(WORKSPACES_DIR, runId, `${repoId(repoRef)}__wp__${wpId}`);
  }
  return join(WORKSPACES_DIR, `${runId}__wp__${wpId}`);
}

function legacyWpWorktreePath(runId: string, wpId: string): string {
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
  repoRef?: string,
): string {
  const wtPath = wpWorktreePath(runId, wpId, repoRef);
  mkdirSync(dirname(wtPath), { recursive: true });
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
export function cleanupWpWorktree(runId: string, wpId: string, repoRef?: string): void {
  for (const wtPath of [
    ...(repoRef != null && repoRef.length > 0 ? [wpWorktreePath(runId, wpId, repoRef)] : []),
    wpWorktreePath(runId, wpId),
    legacyWpWorktreePath(runId, wpId),
  ]) {
    if (!existsSync(wtPath)) continue;
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
}

/**
 * Removes all WP scratch worktrees created for a given runId.
 * Called by the orchestrator in its finally block on both success and failure paths.
 */
export function cleanupAllWpWorktrees(runId: string, wpIds: string[], repoRef?: string): void {
  for (const wpId of wpIds) {
    cleanupWpWorktree(runId, wpId, repoRef);
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
 * @returns Commit result. `no-changes` means no commit was created.
 */
export type OrchestratorCommitAllResult =
  | { status: 'committed'; sha: string }
  | { status: 'no-changes' };

export function orchestratorCommitAll(
  worktreePath: string,
  commitMsg: string,
): OrchestratorCommitAllResult {
  execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe', env: GIT_ENV });
  const stagedDiff = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: worktreePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });
  if (stagedDiff.status === 0) return { status: 'no-changes' };
  if (stagedDiff.status !== 1) {
    throw new Error(`git diff --cached --quiet failed with status ${stagedDiff.status}`);
  }
  execFileSync('git', ['commit', '-m', commitMsg], {
    cwd: worktreePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
  return { status: 'committed', sha };
}

/**
 * Pushes the current worktree HEAD to an existing orchestrator-managed branch.
 *
 * Used by repair workflows that reuse an already-open PR instead of opening a
 * new one. `--force-with-lease` preserves retry semantics without clobbering a
 * branch that moved independently.
 */
export function orchestratorPushBranch(worktreePath: string, branchName: string): void {
  if (branchName.trim().length === 0) {
    throw new Error('branchName is required to push orchestrator changes');
  }
  execFileSync('git', ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branchName}`], {
    cwd: worktreePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });
}

export function resolveRemoteBranchHead(worktreePath: string, branchName: string): string {
  if (branchName.trim().length === 0) {
    throw new Error('branchName is required to verify remote branch head');
  }
  const output = execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branchName}`], {
    cwd: worktreePath,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
  const [sha] = output.split(/\s+/);
  if (sha == null || sha.length === 0) {
    throw new Error(`remote branch not found after push: ${branchName}`);
  }
  return sha;
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
