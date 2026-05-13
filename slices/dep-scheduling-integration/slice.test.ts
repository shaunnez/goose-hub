/**
 * M11.10 — dependency-aware scheduling integration tests.
 *
 * Wires the full stack: createProjectAwareTargetSource → DependencyResolver →
 * filterEligibleByDependencies → ProjectParallelLock. Tests cross-component
 * interactions that unit tests in individual slices cannot cover.
 *
 * All tests use per-project fetcher overrides through createProjectAwareTargetSource
 * (the real project-registry wiring layer) rather than injecting FetchTargetFn
 * directly. The live-GitHub-API test is guarded by GITHUB_TOKEN.
 */
import { filterEligibleByDependencies } from '@goose-hub/core/projects/dependency-scheduler.js';
import { moveIssueToCurrent } from '@goose-hub/core/projects/move-with-deps.js';
import { ProjectParallelLock } from '@goose-hub/core/projects/parallel-lock.js';
import {
  type ProjectIssueFetcher,
  createProjectAwareTargetSource,
} from '@goose-hub/core/state-source/dependency-resolver.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAIN_REPO = 'shaunnez/goose-hub';
const CROSS_REPO = 'shaunnez/other-project';
const UNREGISTERED_REPO = 'external/stranger';

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
    budgets: { maxParallelAgents: 2 } as ProjectConfig['budgets'],
    governance: { immutablePaths: [] },
    isolation: { mode: 'native' },
    archiveAfterDays: 30,
    visibility: 'always_visible',
    colorStripe: '#7c3aed',
  };
}

function makeItem(
  externalId: string,
  body: string,
  schedule: WorkItem['schedule'] = 'current',
): WorkItem {
  return {
    id: `github:${MAIN_REPO}#${externalId}`,
    externalId,
    repoRef: MAIN_REPO,
    title: `Issue #${externalId}`,
    body,
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:dev-ready',
    authorIsOwner: true,
    schedule,
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
  };
}

function makeSource(
  setLabelMock = vi.fn().mockResolvedValue(undefined),
  forceStateMock = vi.fn().mockResolvedValue(undefined),
  commentMock = vi.fn().mockResolvedValue(undefined),
): StateSource {
  return {
    setLabelInGroup: setLabelMock,
    forceState: forceStateMock,
    comment: commentMock,
  } as unknown as StateSource;
}

// ---------------------------------------------------------------------------
// 1. Same-repo dep: two-tick simulation (B open → B closes → A dispatched)
// ---------------------------------------------------------------------------

describe('same-repo dependency: two-tick unblock cycle', () => {
  it('tick 1 (dep open) → A blocked; tick 2 (dep closed) → A eligible', async () => {
    let depState: 'open' | 'closed' = 'open';

    const buildFetchTarget = () =>
      createProjectAwareTargetSource({
        projects: [makeProject(MAIN_REPO)],
        fetchTargetForProject: (): ProjectIssueFetcher => async (_repo, _num) => ({
          state: depState,
          title: 'Blocking issue',
        }),
      });

    const itemA = makeItem('300', 'Depends on #999');
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const source = makeSource(setLabel);

    // ── Tick 1: dep is open ──────────────────────────────────────────────
    const fetchTargetTick1 = await buildFetchTarget();
    const tick1 = await filterEligibleByDependencies([itemA], {
      currentRepo: MAIN_REPO,
      fetchTarget: fetchTargetTick1,
      source,
    });

    expect(tick1.blocked).toHaveLength(1);
    expect(tick1.blocked[0].externalId).toBe('300');
    expect(tick1.eligible).toHaveLength(0);
    expect(setLabel).toHaveBeenCalledWith('300', 'schedule', 'blocked-by');

    // ── Dep closes between ticks ─────────────────────────────────────────
    depState = 'closed';
    setLabel.mockClear();

    // ── Tick 2: dep now closed — scheduler restores schedule:current ─────
    const itemABlocked = { ...itemA, schedule: 'blocked-by' as const };
    const fetchTargetTick2 = await buildFetchTarget();
    const tick2 = await filterEligibleByDependencies([itemABlocked], {
      currentRepo: MAIN_REPO,
      fetchTarget: fetchTargetTick2,
      source,
    });

    expect(tick2.eligible).toHaveLength(1);
    expect(tick2.eligible[0].externalId).toBe('300');
    expect(tick2.blocked).toHaveLength(0);
    expect(setLabel).toHaveBeenCalledWith('300', 'schedule', 'current');
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-repo registered dep: resolver routes through project registry
// ---------------------------------------------------------------------------

describe('cross-repo registered dependency', () => {
  it('dep in registered cross-repo (open) blocks A; dep closes → A eligible', async () => {
    let crossDepState: 'open' | 'closed' = 'open';

    const fetchers: Record<string, ProjectIssueFetcher> = {
      [MAIN_REPO]: async () => ({ state: 'open', title: 'main repo issue' }),
      [CROSS_REPO]: async () => ({ state: crossDepState, title: 'cross-repo dep' }),
    };

    const buildFetchTarget = () =>
      createProjectAwareTargetSource({
        projects: [makeProject(MAIN_REPO), makeProject(CROSS_REPO)],
        fetchTargetForProject: (p) => {
          if (p.source.kind === 'github' && fetchers[p.source.repo] != null) {
            return fetchers[p.source.repo];
          }
          return async () => ({ state: 'open', title: 'fallback' });
        },
      });

    const itemA = makeItem('400', `Depends on ${CROSS_REPO}#55`);
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const source = makeSource(setLabel);

    // ── Tick 1: cross-repo dep is open ───────────────────────────────────
    const tick1 = await filterEligibleByDependencies([itemA], {
      currentRepo: MAIN_REPO,
      fetchTarget: await buildFetchTarget(),
      source,
    });

    expect(tick1.blocked).toHaveLength(1);
    expect(tick1.unregistered).toHaveLength(0);
    expect(setLabel).toHaveBeenCalledWith('400', 'schedule', 'blocked-by');

    // ── Dep closes ───────────────────────────────────────────────────────
    crossDepState = 'closed';
    setLabel.mockClear();

    // ── Tick 2: cross-repo dep now closed → A eligible ───────────────────
    const itemABlocked = { ...itemA, schedule: 'blocked-by' as const };
    const tick2 = await filterEligibleByDependencies([itemABlocked], {
      currentRepo: MAIN_REPO,
      fetchTarget: await buildFetchTarget(),
      source,
    });

    expect(tick2.eligible).toHaveLength(1);
    expect(tick2.blocked).toHaveLength(0);
    expect(setLabel).toHaveBeenCalledWith('400', 'schedule', 'current');
  });
});

// ---------------------------------------------------------------------------
// 3. Unregistered cross-repo dep → factory:needs-human within one tick
// ---------------------------------------------------------------------------

describe('unregistered cross-repo dependency', () => {
  it('dep in unregistered repo → forceState(needs-human) + comment on first tick', async () => {
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject(MAIN_REPO)],
      fetchTargetForProject: (): ProjectIssueFetcher => async () => ({
        state: 'open',
        title: 'local',
      }),
    });

    const itemA = makeItem('500', `Depends on ${UNREGISTERED_REPO}#7`);
    const setLabel = vi.fn();
    const forceState = vi.fn().mockResolvedValue(undefined);
    const comment = vi.fn().mockResolvedValue(undefined);
    const source = makeSource(setLabel, forceState, comment);

    const result = await filterEligibleByDependencies([itemA], {
      currentRepo: MAIN_REPO,
      fetchTarget,
      source,
    });

    expect(result.unregistered).toHaveLength(1);
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);

    // No schedule label change — unregistered path skips schedule label
    expect(setLabel).not.toHaveBeenCalled();

    // Comment posted before state forced (idempotency guard requires this order)
    expect(comment).toHaveBeenCalledWith('500', expect.stringContaining(UNREGISTERED_REPO));
    expect(forceState).toHaveBeenCalledWith('500', 'factory:needs-human');

    // Verify comment precedes forceState (partial-failure guard)
    const commentOrder = comment.mock.invocationCallOrder[0];
    const forceStateOrder = forceState.mock.invocationCallOrder[0];
    expect(commentOrder).toBeLessThan(forceStateOrder);
  });

  it('already factory:needs-human → no re-escalation on subsequent ticks', async () => {
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject(MAIN_REPO)],
      fetchTargetForProject: (): ProjectIssueFetcher => async () => ({
        state: 'open',
        title: 'local',
      }),
    });

    const itemA = makeItem('501', `Depends on ${UNREGISTERED_REPO}#7`);
    itemA.state = 'factory:needs-human';

    const forceState = vi.fn();
    const comment = vi.fn();
    const source = makeSource(vi.fn(), forceState, comment);

    const result = await filterEligibleByDependencies([itemA], {
      currentRepo: MAIN_REPO,
      fetchTarget,
      source,
    });

    expect(result.unregistered).toHaveLength(1);
    expect(forceState).not.toHaveBeenCalled();
    expect(comment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Move-with-deps: --with-dependencies moves all open deps + item
// ---------------------------------------------------------------------------

describe('move-with-deps integration', () => {
  it('--with-dependencies: all open deps moved to schedule:current', async () => {
    const lifecycle: Record<string, 'open' | 'closed'> = {
      [`${MAIN_REPO}#10`]: 'open',
      [`${MAIN_REPO}#11`]: 'closed',
    };

    const fetchLifecycle = vi.fn(async (repo: string, num: number) => {
      return lifecycle[`${repo}#${num}`] ?? 'open';
    });

    const setSchedule = vi.fn().mockResolvedValue(undefined);

    const result = await moveIssueToCurrent(
      'Depends on #10\nDepends on #11',
      MAIN_REPO,
      200,
      'with-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    // Open dep #10 moved; closed dep #11 skipped; issue itself moved
    expect(setSchedule).toHaveBeenCalledWith(MAIN_REPO, 10, 'current');
    expect(setSchedule).toHaveBeenCalledWith(MAIN_REPO, 200, 'current');
    expect(setSchedule).not.toHaveBeenCalledWith(MAIN_REPO, 11, 'current');
    expect(result.depsMoved).toHaveLength(1);
    expect(result.depsMoved[0].issueNumber).toBe(10);
    expect(result.depsSkipped).toHaveLength(1);
    expect(result.depsSkipped[0].issueNumber).toBe(11);
  });

  it('--ignore-dependencies: item moved; scheduler immediately re-blocks on open dep', async () => {
    const fetchLifecycle = vi.fn(async () => 'open' as const);
    const setSchedule = vi.fn().mockResolvedValue(undefined);

    // Step 1: move the item ignoring its open dep
    const moveResult = await moveIssueToCurrent(
      'Depends on #20',
      MAIN_REPO,
      201,
      'ignore-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    expect(setSchedule).toHaveBeenCalledOnce();
    expect(setSchedule).toHaveBeenCalledWith(MAIN_REPO, 201, 'current');
    expect(moveResult.depsMoved).toHaveLength(0);
    expect(moveResult.depsSkipped).toHaveLength(1);

    // Step 2: scheduler runs — item is in schedule:current but dep is open → blocked again
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject(MAIN_REPO)],
      fetchTargetForProject: (): ProjectIssueFetcher => async () => ({
        state: 'open',
        title: 'open dep',
      }),
    });

    const setLabel = vi.fn().mockResolvedValue(undefined);
    const source = makeSource(setLabel);
    const item = makeItem('201', 'Depends on #20', 'current');

    const scheduled = await filterEligibleByDependencies([item], {
      currentRepo: MAIN_REPO,
      fetchTarget,
      source,
    });

    expect(scheduled.blocked).toHaveLength(1);
    expect(scheduled.eligible).toHaveLength(0);
    expect(setLabel).toHaveBeenCalledWith('201', 'schedule', 'blocked-by');
  });
});

// ---------------------------------------------------------------------------
// 5. Parallel dispatch: maxParallelAgents=2 — two of three eligible dispatched
// ---------------------------------------------------------------------------

describe('parallel dispatch integration', () => {
  it('maxParallelAgents=2: two non-conflicting eligible issues both acquire slots', async () => {
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject(MAIN_REPO)],
      // No deps: all items satisfy immediately
      fetchTargetForProject: (): ProjectIssueFetcher => async () => ({
        state: 'closed',
        title: 'dep',
      }),
    });

    const items = [makeItem('600', 'No deps'), makeItem('601', 'No deps')];
    const source = makeSource();

    const { eligible } = await filterEligibleByDependencies(items, {
      currentRepo: MAIN_REPO,
      fetchTarget,
      source,
    });

    expect(eligible).toHaveLength(2);

    const lock = new ProjectParallelLock();
    const MAX = 2;

    const dispatched: WorkItem[] = [];
    for (const item of eligible) {
      if (lock.tryAcquire('goose-hub-self', Number(item.externalId), MAX)) {
        dispatched.push(item);
      }
    }

    expect(dispatched).toHaveLength(2);
    expect(lock.inFlightCount('goose-hub-self')).toBe(2);
  });

  it('maxParallelAgents=2: three eligible issues — only two dispatched; third waits', async () => {
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject(MAIN_REPO)],
      fetchTargetForProject: (): ProjectIssueFetcher => async () => ({
        state: 'closed',
        title: 'dep',
      }),
    });

    const items = [
      makeItem('700', 'No deps'),
      makeItem('701', 'No deps'),
      makeItem('702', 'No deps'),
    ];
    const source = makeSource();

    const { eligible } = await filterEligibleByDependencies(items, {
      currentRepo: MAIN_REPO,
      fetchTarget,
      source,
    });

    expect(eligible).toHaveLength(3);

    const lock = new ProjectParallelLock();
    const MAX = 2;

    const dispatched: WorkItem[] = [];
    const deferred: WorkItem[] = [];

    for (const item of eligible) {
      if (lock.tryAcquire('goose-hub-self', Number(item.externalId), MAX)) {
        dispatched.push(item);
      } else {
        deferred.push(item);
      }
    }

    expect(dispatched).toHaveLength(2);
    expect(deferred).toHaveLength(1);
    expect(lock.inFlightCount('goose-hub-self')).toBe(2);

    // After one completes, the deferred item can proceed
    const completedId = Number(dispatched[0].externalId);
    lock.release('goose-hub-self', completedId);

    const deferredId = Number(deferred[0].externalId);
    expect(lock.tryAcquire('goose-hub-self', deferredId, MAX)).toBe(true);
    expect(lock.inFlightCount('goose-hub-self')).toBe(2);
  });

  it('parallel dispatch does not bleed across projects', async () => {
    const lock = new ProjectParallelLock();
    const MAX = 1;

    // Project A fills its cap
    expect(lock.tryAcquire('project-a', 1, MAX)).toBe(true);
    expect(lock.tryAcquire('project-a', 2, MAX)).toBe(false);

    // Project B's cap is independent
    expect(lock.tryAcquire('project-b', 1, MAX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Live GitHub API smoke (only runs when GITHUB_TOKEN is set)
// ---------------------------------------------------------------------------

const TOKEN = process.env.GITHUB_TOKEN ?? '';

describe('live GitHub API smoke', () => {
  it.skipIf(!TOKEN)('createProjectAwareTargetSource resolves a real closed issue', async () => {
    // Issue #1 in this repo has been closed since project inception.
    // Using a stable known-closed issue avoids creating/deleting test fixtures.
    const KNOWN_CLOSED_ISSUE = 1;

    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject(MAIN_REPO)],
      githubToken: TOKEN,
    });

    const result = await fetchTarget(MAIN_REPO, KNOWN_CLOSED_ISSUE);
    expect(result).not.toBeNull();
    expect(result?.state).toBe('closed');
  });

  it.skipIf(!TOKEN)('unregistered repo still returns null via project-aware source', async () => {
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [makeProject(MAIN_REPO)],
      githubToken: TOKEN,
    });

    // UNREGISTERED_REPO is not in the projects list → should return null
    const result = await fetchTarget(UNREGISTERED_REPO, 1);
    expect(result).toBeNull();
  });
});
