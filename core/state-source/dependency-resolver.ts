import { logger } from '../logger.js';
import { loadProjects } from '../projects/loader.js';
import type { ProjectConfig } from '../types.js';
import type { DependencyRef } from './dependency-parser.js';

export type DepLifecycle = 'open' | 'closed' | 'unregistered';

export interface ResolvedDep {
  /** The original ref as parsed from the issue body. */
  ref: DependencyRef;
  /** Owner/repo where the dep was looked up — equals `currentRepo` for same-repo refs. */
  repoRef: string;
  issueNumber: number;
  state: DepLifecycle;
  /** Issue title. Present only when `state !== 'unregistered'`. */
  title?: string;
}

export interface DependencyTarget {
  state: 'open' | 'closed';
  title: string;
}

export type FetchTargetFn = (
  repoRef: string,
  issueNumber: number,
) => Promise<DependencyTarget | null>;

export interface DependencyResolverContext {
  /** Repo of the issue carrying the dep. Used when `ref.repoRef` is null. */
  currentRepo: string;
  /**
   * Adapter resolving `(repoRef, issueNumber) → target | null`.
   *
   * Returns `null` when the repo is not a registered project (drives
   * `state: 'unregistered'`). For registered repos, returns the GitHub-issue
   * lifecycle (`open` | `closed`) plus title.
   *
   * Wiring lives outside the resolver to keep it pure-unit-testable. The
   * canonical wiring is `createProjectAwareTargetSource()`.
   */
  fetchTarget: FetchTargetFn;
}

/**
 * Resolves dependency refs to their lifecycle. Caches results by
 * `(repoRef, issueNumber)` for the lifetime of the instance — construct one
 * resolver per orchestrator tick to satisfy "cached per tick" (M11.03 will
 * also re-evaluate every tick because deps close mid-sprint).
 */
export class DependencyResolver {
  private readonly cache = new Map<string, Promise<ResolvedDep>>();

  constructor(private readonly ctx: DependencyResolverContext) {}

  resolve(ref: DependencyRef): Promise<ResolvedDep> {
    const repoRef = ref.repoRef ?? this.ctx.currentRepo;
    const key = `${repoRef}#${ref.issueNumber}`;
    const cached = this.cache.get(key);
    if (cached != null) return cached;
    const promise = this.fetchOne(ref, repoRef);
    this.cache.set(key, promise);
    return promise;
  }

  private async fetchOne(ref: DependencyRef, repoRef: string): Promise<ResolvedDep> {
    const target = await this.ctx.fetchTarget(repoRef, ref.issueNumber);
    if (target == null) {
      return { ref, repoRef, issueNumber: ref.issueNumber, state: 'unregistered' };
    }
    return {
      ref,
      repoRef,
      issueNumber: ref.issueNumber,
      state: target.state,
      title: target.title,
    };
  }
}

/**
 * Resolve a single dep in one call. Equivalent to constructing a
 * `DependencyResolver` for one ref. Use `DependencyResolver` directly when
 * resolving many refs in one tick to benefit from caching.
 */
export async function resolveDependency(
  ref: DependencyRef,
  ctx: DependencyResolverContext,
): Promise<ResolvedDep> {
  return new DependencyResolver(ctx).resolve(ref);
}

// ---------------------------------------------------------------------------
// Project-aware wiring
// ---------------------------------------------------------------------------

export interface ProjectAwareTargetSourceOptions {
  /** Pre-loaded projects (overrides `loadProjects()`). For tests. */
  projects?: ProjectConfig[];
  /** Override per-project fetcher construction. For tests. */
  fetchTargetForProject?: (project: ProjectConfig) => FetchTargetFn;
  /** GitHub token for the default fetcher. Defaults to `process.env.GITHUB_TOKEN`. */
  githubToken?: string;
}

/**
 * Build a `FetchTargetFn` that consults `loadProjects()` and resolves through
 * the matching project's GitHub source. Cross-repo refs to repos with no
 * registered project return `null` so the resolver surfaces 'unregistered'.
 */
export async function createProjectAwareTargetSource(
  options: ProjectAwareTargetSourceOptions = {},
): Promise<FetchTargetFn> {
  const projects = options.projects ?? (await loadProjects());
  const fetchers = new Map<string, FetchTargetFn>();

  for (const project of projects) {
    const repoRef = project.source.repo;
    const fetcher =
      options.fetchTargetForProject != null
        ? options.fetchTargetForProject(project)
        : defaultFetchTargetForProject(options.githubToken ?? process.env.GITHUB_TOKEN ?? '');
    fetchers.set(repoRef, fetcher);
  }

  return async (repoRef, issueNumber) => {
    const fetcher = fetchers.get(repoRef);
    if (fetcher == null) return null;
    return fetcher(repoRef, issueNumber);
  };
}

/**
 * Default per-project fetcher: hits GitHub's issues endpoint directly.
 *
 * `WorkItem` does not carry GitHub-lifecycle (open/closed) — it carries
 * state-machine state. The dep contract is "issue closed = dep satisfied",
 * which is GitHub-lifecycle, so we hit the API narrowly here rather than
 * widening the `WorkItem` shape across the codebase.
 */
function defaultFetchTargetForProject(token: string): FetchTargetFn {
  return async (repoRef, issueNumber) => {
    try {
      const url = `https://api.github.com/repos/${repoRef}/issues/${issueNumber}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        logger.warn('dependency-resolver: github fetch failed', {
          repoRef,
          issueNumber,
          status: response.status,
        });
        return null;
      }
      const json = (await response.json()) as { state: 'open' | 'closed'; title: string };
      return { state: json.state, title: json.title };
    } catch (err) {
      logger.warn('dependency-resolver: github fetch error', {
        repoRef,
        issueNumber,
        error: String(err),
      });
      return null;
    }
  };
}
