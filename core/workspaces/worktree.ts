import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GIT_ENV } from './git-env.js';

const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');

export type WorkflowBaseSource = 'current-branch' | 'configured-default' | 'fallback-main';

export type WorkflowBase = {
  /** Branch name used for PR base/diff metadata, without an `origin/` prefix. */
  branch: string;
  /** Git ref used when creating detached worktrees. */
  ref: string;
  source: WorkflowBaseSource;
};

export type IntegrationWorktree = {
  worktreePath: string;
  previousHeadSha: string;
};

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

function currentBranch(repo: string): string | null {
  try {
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      env: GIT_ENV,
    }).trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the branch/ref all workflow-created worktrees should use.
 *
 * The running checkout branch wins so local milestone work runs against the
 * same code the operator is looking at. Config/default fallback still uses the
 * remote ref to preserve the previous fresh-from-origin behavior when the
 * server checkout is detached.
 */
export function resolveWorkflowBase(repo: string, configuredDefaultBranch?: string): WorkflowBase {
  const branch = currentBranch(repo);
  if (branch != null) return { branch, ref: branch, source: 'current-branch' };

  const configured = configuredDefaultBranch?.trim();
  if (configured != null && configured.length > 0) {
    const branchName = configured.startsWith('origin/')
      ? configured.slice('origin/'.length)
      : configured;
    return {
      branch: branchName,
      ref: configured.startsWith('origin/') ? configured : `origin/${configured}`,
      source: 'configured-default',
    };
  }

  return { branch: 'main', ref: 'origin/main', source: 'fallback-main' };
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
 * Creates or reattaches the durable per-pipeline integration worktree.
 *
 * The parent repo checkout is used only as the `git worktree add` source. Branch
 * checkout/reset happens inside the integration worktree so the operator's
 * current checkout is not mutated.
 */
export function createIntegrationWorktree(
  repo: string,
  pipelineRunId: string,
  branchName: string,
  baseRef?: string,
): IntegrationWorktree {
  const wtPath = worktreePath(pipelineRunId);
  mkdirSync(WORKSPACES_DIR, { recursive: true });

  if (!existsSync(wtPath)) {
    const args = ['worktree', 'add', '--detach', wtPath];
    if (baseRef != null && baseRef.length > 0) {
      args.push(baseRef);
    }
    execFileSync('git', args, {
      cwd: repo,
      stdio: 'pipe',
      env: GIT_ENV,
    });
  }

  try {
    execFileSync('git', ['checkout', branchName], {
      cwd: wtPath,
      stdio: 'pipe',
      env: GIT_ENV,
    });
  } catch {
    const args = ['checkout', '-B', branchName];
    if (baseRef != null && baseRef.length > 0) {
      args.push(baseRef);
    }
    execFileSync('git', args, {
      cwd: wtPath,
      stdio: 'pipe',
      env: GIT_ENV,
    });
  }

  const previousHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: wtPath,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();

  return { worktreePath: wtPath, previousHeadSha };
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
