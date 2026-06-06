import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { GIT_ENV } from './git-env.js';
import {
  type PackageManager,
  installCommandForPackageManager,
  stackCommandsForWorktree,
} from './stack-commands.js';

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

export class WorktreeDependencyPreflightError extends Error {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly packageManager?: string;
  readonly exitCode?: number | null;
  readonly stderrTail?: string;

  constructor(
    message: string,
    opts: {
      command: readonly string[];
      cwd: string;
      cause?: unknown;
      packageManager?: string;
      exitCode?: number | null;
      stderrTail?: string;
    },
  ) {
    super(message);
    this.name = 'WorktreeDependencyPreflightError';
    this.command = opts.command;
    this.cwd = opts.cwd;
    this.packageManager = opts.packageManager;
    this.exitCode = opts.exitCode;
    this.stderrTail = opts.stderrTail;
    this.cause = opts.cause;
  }
}

/**
 * Resolves the worktree path for a given runId and optional repoRef.
 * Legacy pattern: ~/.factory/workspaces/<runId>/
 * Repo-aware pattern: ~/.factory/workspaces/<runId>/<repoId>/
 */
function worktreePath(runId: string, repoRef?: string): string {
  if (repoRef == null || repoRef.length === 0) return join(WORKSPACES_DIR, runId);
  return join(WORKSPACES_DIR, runId, repoId(repoRef));
}

export function repoId(repoRef: string): string {
  return repoRef
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Returns the worktree path for `runId` IF the directory exists on disk.
 * Used by tail workflows (audit, retro) that want to attach to the dev
 * worktree opportunistically without recreating it.
 */
export function existingWorktreePath(runId: string, repoRef?: string): string | null {
  if (repoRef != null && repoRef.length > 0) {
    const repoAwarePath = worktreePath(runId, repoRef);
    if (existsSync(repoAwarePath)) return repoAwarePath;
  }
  const legacyPath = worktreePath(runId);
  return existsSync(legacyPath) ? legacyPath : null;
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
export function createWorktree(
  repo: string,
  runId: string,
  baseRef?: string,
  repoRef?: string,
): string {
  const wtPath = worktreePath(runId, repoRef);

  // Ensure the parent directory exists for both legacy and repo-aware paths.
  mkdirSync(dirname(wtPath), { recursive: true });

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

function localBranchExists(worktreePath: string, branchName: string): boolean {
  try {
    execFileSync('git', ['show-ref', '--verify', `refs/heads/${branchName}`], {
      cwd: worktreePath,
      stdio: 'pipe',
      env: GIT_ENV,
    });
    return true;
  } catch {
    return false;
  }
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
  repoRef?: string,
): IntegrationWorktree {
  const wtPath = worktreePath(pipelineRunId, repoRef);
  mkdirSync(dirname(wtPath), { recursive: true });

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

  if (localBranchExists(wtPath, branchName)) {
    execFileSync('git', ['checkout', branchName], {
      cwd: wtPath,
      stdio: 'pipe',
      env: GIT_ENV,
    });
  } else {
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

function worktreeIsClean(wtPath: string): boolean {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: wtPath,
    encoding: 'utf8',
    env: GIT_ENV,
  });
  return status.trim().length === 0;
}

function resolveRemoteHead(worktreePath: string, branchName: string): string {
  const output = execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branchName}`], {
    cwd: worktreePath,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
  const [sha] = output.split(/\s+/);
  if (sha == null || sha.length === 0) {
    throw new Error(`remote branch not found: ${branchName}`);
  }
  return sha;
}

/**
 * Reattaches the durable per-pipeline integration worktree and resets it to a
 * remote tip that has already been identified from persisted workflow state.
 *
 * A dirty worktree is a hard stop: automatic cleanup would hide exactly the
 * overwrite condition the durability flow is trying to detect.
 */
export function reattachIntegrationWorktreeAtRemoteTip(
  repo: string,
  pipelineRunId: string,
  branchName: string,
  expectedRemoteSha: string,
  baseRef?: string,
): IntegrationWorktree {
  const integrationWorktree = createIntegrationWorktree(repo, pipelineRunId, branchName, baseRef);

  if (!worktreeIsClean(integrationWorktree.worktreePath)) {
    throw new Error('integration worktree is dirty; refusing to reset to remote tip');
  }

  const remoteHead = resolveRemoteHead(integrationWorktree.worktreePath, branchName);
  if (remoteHead !== expectedRemoteSha) {
    throw new Error(
      `remote branch head mismatch for ${branchName}: expected ${expectedRemoteSha}, got ${remoteHead}`,
    );
  }

  execFileSync('git', ['reset', '--hard', expectedRemoteSha], {
    cwd: integrationWorktree.worktreePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });

  return {
    worktreePath: integrationWorktree.worktreePath,
    previousHeadSha: expectedRemoteSha,
  };
}

/**
 * Runs the selected package manager's install command in the worktree before the
 * agent starts. Eliminates the first wasted turn where the agent discovers and
 * installs dependencies.
 *
 * @param worktreePath - Absolute path to the worktree directory.
 * @param filter - Optional pnpm workspace filter (e.g. `"./apps/web"`). When provided, only that
 *   package and its dependencies are installed.
 */
export async function prewarmWorktree(worktreePath: string, filter?: string): Promise<void> {
  const stack = await stackCommandsForWorktree(worktreePath);
  const packageManager = stack.packageManager;
  if (packageManager !== 'pnpm' && packageManager !== 'npm' && packageManager !== 'yarn') {
    return;
  }
  const command = await installCommandForPackageManager(
    worktreePath,
    packageManager as PackageManager,
    filter,
  );
  try {
    execFileSync(command[0], command.slice(1), {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } catch (err) {
    const details = dependencyPreflightErrorDetails(err);
    throw new WorktreeDependencyPreflightError(
      `worktree dependency preflight failed: ${command.join(' ')}`,
      {
        command,
        cwd: worktreePath,
        packageManager,
        cause: err,
        ...details,
      },
    );
  }
}

function dependencyPreflightErrorDetails(err: unknown): {
  exitCode?: number | null;
  stderrTail?: string;
} {
  if (err == null || typeof err !== 'object') return {};
  const record = err as { status?: unknown; stderr?: unknown };
  const exitCode = typeof record.status === 'number' ? record.status : null;
  const rawStderr = Buffer.isBuffer(record.stderr)
    ? record.stderr.toString('utf8')
    : typeof record.stderr === 'string'
      ? record.stderr
      : '';
  const stderrTail = rawStderr.trim().split('\n').slice(-20).join('\n');
  return {
    exitCode,
    ...(stderrTail.length > 0 ? { stderrTail } : {}),
  };
}

export function assertPnpmPackageExecutableAvailable(
  worktreePath: string,
  packageFilter: string,
  executable: string,
): void {
  const args = ['--filter', packageFilter, 'exec', executable, '--version'];
  try {
    execFileSync('pnpm', args, {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } catch (err) {
    throw new WorktreeDependencyPreflightError(
      `worktree dependencies unavailable: ${packageFilter} ${executable} binary not resolvable`,
      { command: ['pnpm', ...args], cwd: worktreePath, packageManager: 'pnpm', cause: err },
    );
  }
}

export function assertGooseHubWebPlaywrightReady(worktreePath: string): void {
  assertPnpmPackageExecutableAvailable(worktreePath, '@goose-hub/web', 'playwright');
}

/**
 * Removes the git worktree for the given runId or explicit worktree path.
 *
 * Idempotent: if the worktree path does not exist, this is a no-op.
 * If `git worktree remove` fails (e.g. repo already gone), the directory
 * is still removed via rmSync with force.
 *
 * @param runIdOrPath - Canonical workflow isolation key (ULID/UUID), or an absolute worktree path.
 */
export function cleanupWorktree(runIdOrPath: string, repoRef?: string): void {
  const wtPath = isAbsolute(runIdOrPath) ? runIdOrPath : worktreePath(runIdOrPath, repoRef);

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
