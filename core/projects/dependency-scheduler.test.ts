import { describe, expect, it, vi } from 'vitest';
import type { FetchTargetFn } from '../state-source/dependency-resolver.js';
import { DependencyResolver } from '../state-source/dependency-resolver.js';
import type { StateSource, WorkItem } from '../state-source/interface.js';
import { evaluateDependencies, filterEligibleByDependencies } from './dependency-scheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  externalId: string,
  body: string,
  schedule: WorkItem['schedule'] = 'current',
): WorkItem {
  return {
    id: `github:shaunnez/goose-hub#${externalId}`,
    externalId,
    repoRef: 'shaunnez/goose-hub',
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

function makeResolver(targets: Map<string, 'open' | 'closed' | null>): DependencyResolver {
  const fetchTarget: FetchTargetFn = async (repoRef, issueNumber) => {
    const key = `${repoRef}#${issueNumber}`;
    const val = targets.get(key);
    if (val == null) return null; // unregistered
    return { state: val, title: `Issue #${issueNumber}` };
  };
  return new DependencyResolver({ currentRepo: 'shaunnez/goose-hub', fetchTarget });
}

function makeSource(
  setLabelMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  forceStateMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  commentMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): StateSource {
  return {
    setLabelInGroup: setLabelMock,
    forceState: forceStateMock,
    comment: commentMock,
  } as unknown as StateSource;
}

// ---------------------------------------------------------------------------
// evaluateDependencies
// ---------------------------------------------------------------------------

describe('evaluateDependencies', () => {
  it('satisfied — zero deps returns satisfied with empty arrays', async () => {
    const item = makeItem('1', 'No deps here');
    const resolver = makeResolver(new Map());
    const result = await evaluateDependencies(item, resolver);
    expect(result.state).toBe('satisfied');
    expect(result.resolved).toHaveLength(0);
    expect(result.blockingDeps).toHaveLength(0);
    expect(result.unregisteredDeps).toHaveLength(0);
  });

  it('satisfied — all deps closed dispatches as normal', async () => {
    const item = makeItem('2', 'Depends on #10\nDepends on #11');
    const resolver = makeResolver(
      new Map([
        ['shaunnez/goose-hub#10', 'closed'],
        ['shaunnez/goose-hub#11', 'closed'],
      ]),
    );
    const result = await evaluateDependencies(item, resolver);
    expect(result.state).toBe('satisfied');
    expect(result.blockingDeps).toHaveLength(0);
    expect(result.resolved).toHaveLength(2);
  });

  it('blocked — one open dep blocks the item', async () => {
    const item = makeItem('3', 'Depends on #20');
    const resolver = makeResolver(new Map([['shaunnez/goose-hub#20', 'open']]));
    const result = await evaluateDependencies(item, resolver);
    expect(result.state).toBe('blocked');
    expect(result.blockingDeps).toHaveLength(1);
    expect(result.blockingDeps[0].issueNumber).toBe(20);
  });

  it('blocked — mixed open and closed: still blocked', async () => {
    const item = makeItem('4', 'Depends on #30\nDepends on #31');
    const resolver = makeResolver(
      new Map([
        ['shaunnez/goose-hub#30', 'closed'],
        ['shaunnez/goose-hub#31', 'open'],
      ]),
    );
    const result = await evaluateDependencies(item, resolver);
    expect(result.state).toBe('blocked');
    expect(result.blockingDeps).toHaveLength(1);
    expect(result.blockingDeps[0].issueNumber).toBe(31);
  });

  it('unregistered — dep in unknown repo classifies as unregistered', async () => {
    const item = makeItem('5', 'Depends on unknown/repo#99');
    const resolver = makeResolver(new Map()); // no entry → null → unregistered
    const result = await evaluateDependencies(item, resolver);
    expect(result.state).toBe('unregistered');
    expect(result.unregisteredDeps).toHaveLength(1);
    expect(result.unregisteredDeps[0].repoRef).toBe('unknown/repo');
  });

  it('unregistered — unregistered dep takes precedence over open dep', async () => {
    const item = makeItem('6', 'Depends on unknown/repo#1\nDepends on #50');
    const resolver = makeResolver(new Map([['shaunnez/goose-hub#50', 'open']]));
    const result = await evaluateDependencies(item, resolver);
    expect(result.state).toBe('unregistered');
    expect(result.unregisteredDeps).toHaveLength(1);
    expect(result.blockingDeps).toHaveLength(1);
  });

  it('satisfied — "Blocks #N" with open #N does NOT block the current item', async () => {
    // "Blocks #71" means the current issue is a blocker FOR #71, not that the
    // current issue depends on #71. Treating it as a blocker inverts semantics.
    const item = makeItem('7', 'Blocks #71');
    const resolver = makeResolver(new Map([['shaunnez/goose-hub#71', 'open']]));
    const result = await evaluateDependencies(item, resolver);
    expect(result.state).toBe('satisfied');
    expect(result.resolved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterEligibleByDependencies
// ---------------------------------------------------------------------------

describe('filterEligibleByDependencies', () => {
  const currentRepo = 'shaunnez/goose-hub';

  it('eligible — zero-dep item passes through; no label changes', async () => {
    const setLabel = vi.fn();
    const fetchTarget = vi.fn<FetchTargetFn>();
    const item = makeItem('1', 'No deps');
    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });
    expect(result.eligible).toHaveLength(1);
    expect(result.blocked).toHaveLength(0);
    expect(result.unregistered).toHaveLength(0);
    expect(fetchTarget).not.toHaveBeenCalled();
    expect(setLabel).not.toHaveBeenCalled();
  });

  it('eligible — all deps closed; item dispatched', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => ({ state: 'closed', title: 'Done' });
    const item = makeItem('10', 'Depends on #5');
    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });
    expect(result.eligible).toHaveLength(1);
    expect(setLabel).not.toHaveBeenCalled();
  });

  it('eligible — was blocked-by; all deps now closed; restores schedule:current', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => ({ state: 'closed', title: 'Done' });
    const item = makeItem('11', 'Depends on #5', 'blocked-by');
    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });
    expect(result.eligible).toHaveLength(1);
    expect(setLabel).toHaveBeenCalledWith('11', 'schedule', 'current');
  });

  it('blocked — one open dep applies schedule:blocked-by', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => ({ state: 'open', title: 'Open' });
    const item = makeItem('20', 'Depends on #99');
    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });
    expect(result.blocked).toHaveLength(1);
    expect(result.eligible).toHaveLength(0);
    expect(setLabel).toHaveBeenCalledWith('20', 'schedule', 'blocked-by');
  });

  it('blocked — does not re-apply label if already schedule:blocked-by', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => ({ state: 'open', title: 'Open' });
    const item = makeItem('21', 'Depends on #99', 'blocked-by');
    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });
    expect(result.blocked).toHaveLength(1);
    expect(setLabel).not.toHaveBeenCalled();
  });

  it('unregistered — applies factory:needs-human and posts comment on first encounter', async () => {
    const setLabel = vi.fn();
    const forceState = vi.fn().mockResolvedValue(undefined);
    const comment = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => null;
    const item = makeItem('30', 'Depends on external/repo#5');
    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel, forceState, comment),
    });
    expect(result.unregistered).toHaveLength(1);
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
    expect(setLabel).not.toHaveBeenCalled();
    expect(forceState).toHaveBeenCalledWith('30', 'factory:needs-human');
    expect(comment).toHaveBeenCalledWith('30', expect.stringContaining('external/repo#5'));
    expect(comment).toHaveBeenCalledWith('30', expect.stringContaining('not registered'));
  });

  it('unregistered — already factory:needs-human → no re-escalation', async () => {
    const setLabel = vi.fn();
    const forceState = vi.fn().mockResolvedValue(undefined);
    const comment = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => null;
    const item = makeItem('31', 'Depends on external/repo#5');
    // Simulate a previously-escalated item
    item.state = 'factory:needs-human';
    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel, forceState, comment),
    });
    expect(result.unregistered).toHaveLength(1);
    expect(forceState).not.toHaveBeenCalled();
    expect(comment).not.toHaveBeenCalled();
  });

  it('mixed batch — correctly partitions eligible / blocked / unregistered', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const items = [
      makeItem('100', 'No deps'),
      makeItem('101', 'Depends on #200'),
      makeItem('102', 'Depends on nowhere/repo#1'),
      makeItem('103', 'Depends on #201\nDepends on #202'),
    ];
    const fetchTarget: FetchTargetFn = async (repo, num) => {
      if (repo === 'nowhere/repo') return null;
      if (num === 200) return { state: 'open', title: 'Open 200' };
      if (num === 201) return { state: 'closed', title: 'Done 201' };
      if (num === 202) return { state: 'open', title: 'Open 202' };
      return { state: 'closed', title: 'Fallback' };
    };
    const result = await filterEligibleByDependencies(items, {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });
    expect(result.eligible.map((i) => i.externalId)).toEqual(['100']);
    expect(result.blocked.map((i) => i.externalId).sort()).toEqual(['101', '103']);
    expect(result.unregistered.map((i) => i.externalId)).toEqual(['102']);
  });
});
