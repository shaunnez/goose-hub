import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../types.js';
import type { DependencyRef } from './dependency-parser.js';
import {
  DependencyResolver,
  type DependencyTarget,
  DependencyTargetFetchError,
  type FetchTargetFn,
  type ProjectIssueFetcher,
  createProjectAwareTargetSource,
  resolveDependency,
} from './dependency-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sameRepo: DependencyRef = { type: 'depends-on', repoRef: null, issueNumber: 42 };
const crossRepoRegistered: DependencyRef = {
  type: 'depends-on',
  repoRef: 'shaunnez/other-repo',
  issueNumber: 12,
};
const crossRepoUnregistered: DependencyRef = {
  type: 'depends-on',
  repoRef: 'unknown/elsewhere',
  issueNumber: 7,
};

function makeFetchTarget(targets: Map<string, DependencyTarget | null>): FetchTargetFn {
  return async (repoRef, issueNumber) => {
    const key = `${repoRef}#${issueNumber}`;
    return targets.has(key) ? (targets.get(key) ?? null) : null;
  };
}

// ---------------------------------------------------------------------------
// resolveDependency — same-repo
// ---------------------------------------------------------------------------

describe('resolveDependency — same-repo deps', () => {
  it('resolves a same-repo open dep (ref.repoRef is null) to state: open with title', async () => {
    const fetchTarget = makeFetchTarget(
      new Map([['shaunnez/goose-hub#42', { state: 'open', title: 'Open Issue' }]]),
    );

    const result = await resolveDependency(sameRepo, {
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    expect(result).toEqual({
      ref: sameRepo,
      repoRef: 'shaunnez/goose-hub',
      issueNumber: 42,
      state: 'open',
      title: 'Open Issue',
    });
  });

  it('resolves a same-repo closed dep to state: closed', async () => {
    const fetchTarget = makeFetchTarget(
      new Map([['shaunnez/goose-hub#42', { state: 'closed', title: 'Done Issue' }]]),
    );

    const result = await resolveDependency(sameRepo, {
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    expect(result.state).toBe('closed');
    expect(result.title).toBe('Done Issue');
    expect(result.repoRef).toBe('shaunnez/goose-hub');
  });

  it('routes same-repo lookups to currentRepo, not the source map default', async () => {
    const fetchTarget = vi.fn<FetchTargetFn>(async () => ({ state: 'open', title: 't' }));
    await resolveDependency(sameRepo, { currentRepo: 'foo/bar', fetchTarget });
    expect(fetchTarget).toHaveBeenCalledWith('foo/bar', 42);
  });
});

// ---------------------------------------------------------------------------
// resolveDependency — cross-repo registered
// ---------------------------------------------------------------------------

describe('resolveDependency — cross-repo registered', () => {
  it('resolves a registered cross-repo open dep', async () => {
    const fetchTarget = makeFetchTarget(
      new Map([['shaunnez/other-repo#12', { state: 'open', title: 'Across' }]]),
    );

    const result = await resolveDependency(crossRepoRegistered, {
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    expect(result).toEqual({
      ref: crossRepoRegistered,
      repoRef: 'shaunnez/other-repo',
      issueNumber: 12,
      state: 'open',
      title: 'Across',
    });
  });

  it('resolves a registered cross-repo closed dep', async () => {
    const fetchTarget = makeFetchTarget(
      new Map([['shaunnez/other-repo#12', { state: 'closed', title: 'Across (done)' }]]),
    );

    const result = await resolveDependency(crossRepoRegistered, {
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    expect(result.state).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// resolveDependency — unregistered
// ---------------------------------------------------------------------------

describe('resolveDependency — unregistered cross-repo', () => {
  it('returns state: unregistered when fetchTarget returns null', async () => {
    const fetchTarget: FetchTargetFn = async () => null;

    const result = await resolveDependency(crossRepoUnregistered, {
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    expect(result).toEqual({
      ref: crossRepoUnregistered,
      repoRef: 'unknown/elsewhere',
      issueNumber: 7,
      state: 'unregistered',
    });
    expect(result.title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DependencyResolver — per-tick caching
// ---------------------------------------------------------------------------

describe('DependencyResolver — per-tick caching', () => {
  it('caches by (repoRef, issueNumber): repeated resolve does not re-fetch', async () => {
    const fetchTarget = vi.fn<FetchTargetFn>(async () => ({ state: 'open', title: 't' }));
    const resolver = new DependencyResolver({
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    await resolver.resolve(sameRepo);
    await resolver.resolve(sameRepo);
    await resolver.resolve({ type: 'blocks', repoRef: null, issueNumber: 42 });

    expect(fetchTarget).toHaveBeenCalledTimes(1);
  });

  it('does not share cache across resolver instances (one resolver per tick)', async () => {
    const fetchTarget = vi.fn<FetchTargetFn>(async () => ({ state: 'open', title: 't' }));

    const tickA = new DependencyResolver({ currentRepo: 'r/a', fetchTarget });
    await tickA.resolve(sameRepo);

    const tickB = new DependencyResolver({ currentRepo: 'r/a', fetchTarget });
    await tickB.resolve(sameRepo);

    expect(fetchTarget).toHaveBeenCalledTimes(2);
  });

  it('caches concurrent resolves of the same ref to a single fetch', async () => {
    const fetchTarget = vi.fn<FetchTargetFn>(async () => ({ state: 'open', title: 't' }));
    const resolver = new DependencyResolver({
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    await Promise.all([resolver.resolve(sameRepo), resolver.resolve(sameRepo)]);

    expect(fetchTarget).toHaveBeenCalledTimes(1);
  });

  it('caches unregistered results too — does not retry on miss within a tick', async () => {
    const fetchTarget = vi.fn<FetchTargetFn>(async () => null);
    const resolver = new DependencyResolver({
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    await resolver.resolve(crossRepoUnregistered);
    await resolver.resolve(crossRepoUnregistered);

    expect(fetchTarget).toHaveBeenCalledTimes(1);
  });

  it('treats same-repo (null repoRef) and explicit-currentRepo refs as the same cache key', async () => {
    const fetchTarget = vi.fn<FetchTargetFn>(async () => ({ state: 'open', title: 't' }));
    const resolver = new DependencyResolver({
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    await resolver.resolve({ type: 'depends-on', repoRef: null, issueNumber: 42 });
    await resolver.resolve({
      type: 'depends-on',
      repoRef: 'shaunnez/goose-hub',
      issueNumber: 42,
    });

    expect(fetchTarget).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createProjectAwareTargetSource — loadProjects() wiring
// ---------------------------------------------------------------------------

function makeProject(repoRef: string): ProjectConfig {
  return {
    id: repoRef,
    name: repoRef,
    slug: repoRef.replace('/', '-'),
    source: { kind: 'github', repo: repoRef, stateMachine: 'labels' },
    targetRepo: { cloneUrl: '', defaultBranch: 'main', localPath: '' },
    stack: { runtime: 'node', packageManager: 'pnpm', testCommand: 'true', detectedAt: '' },
    mode: 'supervised',
    storage: { kind: 'local', path: '' },
    repos: [repoRef],
    agentConfig: {} as ProjectConfig['agentConfig'],
    budgets: {} as ProjectConfig['budgets'],
    governance: { immutablePaths: [] },
    isolation: { mode: 'native' },
    archiveAfterDays: 30,
    visibility: 'always_visible',
    colorStripe: '#fff',
  };
}

describe('createProjectAwareTargetSource', () => {
  it('routes registered cross-repo lookups to the matching project fetcher', async () => {
    const goosehubFetcher = vi.fn<ProjectIssueFetcher>(async () => ({
      state: 'open',
      title: 'in goose-hub',
    }));
    const otherFetcher = vi.fn<ProjectIssueFetcher>(async () => ({
      state: 'closed',
      title: 'in other',
    }));

    const fetch = await createProjectAwareTargetSource({
      projects: [makeProject('shaunnez/goose-hub'), makeProject('shaunnez/other-repo')],
      fetchTargetForProject: (p) =>
        p.source.repo === 'shaunnez/goose-hub' ? goosehubFetcher : otherFetcher,
    });

    const result = await fetch('shaunnez/other-repo', 99);

    expect(result).toEqual({ state: 'closed', title: 'in other' });
    expect(otherFetcher).toHaveBeenCalledWith('shaunnez/other-repo', 99);
    expect(goosehubFetcher).not.toHaveBeenCalled();
  });

  it('returns null for repos with no registered project (drives unregistered)', async () => {
    const fetch = await createProjectAwareTargetSource({
      projects: [makeProject('shaunnez/goose-hub')],
      fetchTargetForProject: () => async () => ({ state: 'open', title: 't' }),
    });

    expect(await fetch('not/registered', 1)).toBeNull();
  });

  it('end-to-end: resolver + project-aware target source surfaces unregistered for a stranger repo', async () => {
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject('shaunnez/goose-hub')],
      fetchTargetForProject: () => async (_, n) => ({
        state: 'open',
        title: `local#${n}`,
      }),
    });

    const resolver = new DependencyResolver({
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    const localOpen = await resolver.resolve({
      type: 'depends-on',
      repoRef: null,
      issueNumber: 42,
    });
    expect(localOpen).toMatchObject({
      state: 'open',
      repoRef: 'shaunnez/goose-hub',
      title: 'local#42',
    });

    const stranger = await resolver.resolve({
      type: 'depends-on',
      repoRef: 'unknown/repo',
      issueNumber: 7,
    });
    expect(stranger).toMatchObject({ state: 'unregistered', repoRef: 'unknown/repo' });
  });

  it('propagates errors from per-project fetchers (404 on registered repo ≠ unregistered)', async () => {
    const failingFetcher: ProjectIssueFetcher = async () => {
      throw new DependencyTargetFetchError(
        'shaunnez/goose-hub',
        404,
        404,
        'GitHub returned 404 for shaunnez/goose-hub#404',
      );
    };

    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject('shaunnez/goose-hub')],
      fetchTargetForProject: () => failingFetcher,
    });

    await expect(fetchTarget('shaunnez/goose-hub', 404)).rejects.toBeInstanceOf(
      DependencyTargetFetchError,
    );
  });

  it('resolver surfaces fetch errors as rejections, not as state: unregistered', async () => {
    const failingFetcher: ProjectIssueFetcher = async () => {
      throw new DependencyTargetFetchError('shaunnez/goose-hub', 404, 404, 'not found');
    };

    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject('shaunnez/goose-hub')],
      fetchTargetForProject: () => failingFetcher,
    });

    const resolver = new DependencyResolver({
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    await expect(
      resolver.resolve({ type: 'depends-on', repoRef: null, issueNumber: 404 }),
    ).rejects.toBeInstanceOf(DependencyTargetFetchError);
  });
});
