import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { listProjectRepositories } from '../projects/repositories.js';
import type { BranchStrategyConfig, ProjectConfig, ProjectRepositoryConfig } from '../types.js';
import { GIT_ENV } from './git-env.js';
import type { SelectedWorkItemRepository } from './repo-affinity.js';
import type { WorkflowBase } from './worktree.js';

const REPOS_DIR = join(homedir(), '.factory', 'repos');

export interface CheckoutReadinessResult {
  repoRef: string;
  clonePath: string;
  baseBranch: string;
  baseRef: string;
  selectionReason: string;
  checkoutSource: 'managed-clone';
  configuredLocalPath?: string | null;
}

export interface PreparedWorkItemRepository extends SelectedWorkItemRepository {
  workflowBase?: WorkflowBase;
  readiness?: {
    checkoutSource:
      | 'configured-local-path'
      | 'project-target-path'
      | 'fallback-path'
      | 'managed-clone';
    selectionSource?: SelectedWorkItemRepository['checkoutSource'];
    checkoutPath: string;
    configuredLocalPath?: string | null;
    managedClonePath?: string;
  };
}

export interface EnsureRepositoryCheckoutOptions {
  cloneRoot?: string;
  branchStrategy?: BranchStrategyConfig;
  selectionReason?: string;
}

export function repositoryClonePath(
  projectId: string,
  repoRef: string,
  cloneRoot = REPOS_DIR,
): string {
  return join(cloneRoot, projectId, repoRef);
}

export function normalizeRepoRemote(value: string): string {
  const trimmed = value.trim();
  const scp = trimmed.includes('://') ? null : trimmed.match(/^([^@/:]+@)?([^:]+):(.+)$/);
  const urlish = scp == null ? trimmed : `ssh://${scp[1] ?? ''}${scp[2]}/${scp[3]}`;
  try {
    const url = new URL(urlish);
    const repoPath = url.pathname
      .replace(/^\/+/, '')
      .replace(/\.git$/i, '')
      .toLowerCase();
    return `${url.hostname.toLowerCase()}/${repoPath}`;
  } catch {
    return trimmed.replace(/\.git$/i, '').toLowerCase();
  }
}

function remoteMatches(actual: string, expected: string): boolean {
  return normalizeRepoRemote(actual) === normalizeRepoRemote(expected);
}

function repoName(repoRef: string): string {
  return repoRef.split('/').filter(Boolean).at(-1) ?? repoRef;
}

function remoteHeadBranch(repoPath: string): string | null {
  try {
    const output = execFileSync(
      'git',
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      {
        cwd: repoPath,
        encoding: 'utf8',
        env: GIT_ENV,
      },
    ).trim();
    return output.startsWith('origin/') ? output.slice('origin/'.length) : output;
  } catch {
    return null;
  }
}

function remoteBranchExists(repoPath: string, branch: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', `origin/${branch}`], {
      cwd: repoPath,
      stdio: 'pipe',
      env: GIT_ENV,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveConfiguredBase(
  repoPath: string,
  repoConfig: ProjectRepositoryConfig,
  branchStrategy?: BranchStrategyConfig,
): WorkflowBase {
  const strategy = repoConfig.branchStrategy ?? branchStrategy;
  const candidates: string[] = [];
  const name = repoName(repoConfig.repoRef);
  for (const preference of strategy?.preferredBranches ?? []) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(preference.repoNamePattern);
    } catch {
      continue;
    }
    if (pattern.test(name)) candidates.push(...preference.branches);
  }
  if (repoConfig.defaultBranch.trim().length > 0) candidates.push(repoConfig.defaultBranch);
  if (strategy?.useRemoteHeadFallback !== false) {
    const head = remoteHeadBranch(repoPath);
    if (head != null) candidates.push(head);
  }
  candidates.push(...(strategy?.fallbackBranches ?? ['main', 'master']));
  for (const branch of [...new Set(candidates.map((value) => value.trim()).filter(Boolean))]) {
    const branchName = branch.startsWith('origin/') ? branch.slice('origin/'.length) : branch;
    if (remoteBranchExists(repoPath, branchName)) {
      return { branch: branchName, ref: `origin/${branchName}`, source: 'configured-default' };
    }
  }
  throw new Error(`no checkout base branch found for ${repoConfig.repoRef}`);
}

export function ensureRepositoryCheckout(
  projectId: string,
  repoConfig: ProjectRepositoryConfig,
  options: EnsureRepositoryCheckoutOptions = {},
): CheckoutReadinessResult {
  const clonePath = repositoryClonePath(projectId, repoConfig.repoRef, options.cloneRoot);
  if (!existsSync(clonePath)) {
    mkdirSync(dirname(clonePath), { recursive: true });
    execFileSync('git', ['clone', repoConfig.cloneUrl, clonePath], {
      stdio: 'pipe',
      env: GIT_ENV,
    });
  } else {
    const stat = statSync(clonePath);
    if (!stat.isDirectory()) {
      throw new Error(`repository checkout path exists but is not a directory: ${clonePath}`);
    }
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: clonePath,
        stdio: 'pipe',
        env: GIT_ENV,
      });
    } catch {
      throw new Error(`repository checkout path is not a git repository: ${clonePath}`);
    }
  }

  const actualRemote = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: clonePath,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
  if (!remoteMatches(actualRemote, repoConfig.cloneUrl)) {
    throw new Error(
      `repository checkout remote mismatch for ${repoConfig.repoRef}: expected ${normalizeRepoRemote(
        repoConfig.cloneUrl,
      )}, got ${normalizeRepoRemote(actualRemote)}`,
    );
  }

  execFileSync('git', ['fetch', 'origin', '--prune'], {
    cwd: clonePath,
    stdio: 'pipe',
    env: GIT_ENV,
  });

  const base = resolveConfiguredBase(clonePath, repoConfig, options.branchStrategy);
  return {
    repoRef: repoConfig.repoRef,
    clonePath,
    baseBranch: base.branch,
    baseRef: base.ref,
    selectionReason: options.selectionReason ?? 'repo-link-primary',
    checkoutSource: 'managed-clone',
    configuredLocalPath: repoConfig.localPath.length > 0 ? repoConfig.localPath : null,
  };
}

export function ensureSelectedRepositoryCheckout(
  project: ProjectConfig | null | undefined,
  selected: SelectedWorkItemRepository,
): PreparedWorkItemRepository {
  if (project == null) return selected;
  const repoConfig = listProjectRepositories(project).find(
    (repo) => repo.repoRef === selected.repoRef,
  );
  if (repoConfig == null || repoConfig.cloneUrl.trim().length === 0) return selected;

  const checkout = ensureRepositoryCheckout(project.id, repoConfig, {
    branchStrategy: project.branchStrategy,
    selectionReason: selected.selectedBy,
  });
  return {
    ...selected,
    localPath: checkout.clonePath,
    defaultBranch: checkout.baseBranch,
    checkoutSource: 'managed-clone',
    readiness: {
      checkoutSource: 'managed-clone',
      selectionSource: selected.checkoutSource,
      checkoutPath: checkout.clonePath,
      configuredLocalPath: checkout.configuredLocalPath,
      managedClonePath: checkout.clonePath,
    },
    workflowBase: {
      branch: checkout.baseBranch,
      ref: checkout.baseRef,
      source: 'configured-default',
    },
  };
}
