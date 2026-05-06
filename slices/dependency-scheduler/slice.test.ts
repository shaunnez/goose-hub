import { filterEligibleByDependencies } from '@goose-hub/core/projects/dependency-scheduler.js';
import type { FetchTargetFn } from '@goose-hub/core/state-source/dependency-resolver.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { describe, expect, it, vi } from 'vitest';

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
// dependency-scheduler slice — end-to-end
// ---------------------------------------------------------------------------

describe('dependency-scheduler slice — end-to-end', () => {
  const currentRepo = 'shaunnez/goose-hub';

  it('zero deps → eligible; no API calls made', async () => {
    const setLabel = vi.fn();
    const fetchTarget = vi.fn<FetchTargetFn>();
    const item = makeItem('1', 'No dependencies here');

    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });

    expect(result.eligible[0].externalId).toBe('1');
    expect(result.blocked).toHaveLength(0);
    expect(result.unregistered).toHaveLength(0);
    expect(fetchTarget).not.toHaveBeenCalled();
    expect(setLabel).not.toHaveBeenCalled();
  });

  it('one open dep → blocked with schedule:blocked-by applied', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => ({ state: 'open', title: 'Open dep' });
    const item = makeItem('2', 'Depends on #100');

    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });

    expect(result.blocked[0].externalId).toBe('2');
    expect(result.eligible).toHaveLength(0);
    expect(setLabel).toHaveBeenCalledWith('2', 'schedule', 'blocked-by');
  });

  it('dep closes between ticks → schedule:blocked-by removed; item eligible', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => ({ state: 'closed', title: 'Done dep' });
    const item = makeItem('3', 'Depends on #200', 'blocked-by');

    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });

    expect(result.eligible[0].externalId).toBe('3');
    expect(setLabel).toHaveBeenCalledWith('3', 'schedule', 'current');
  });

  it('unregistered cross-repo dep → escalate to factory:needs-human + comment posted', async () => {
    const setLabel = vi.fn();
    const forceState = vi.fn().mockResolvedValue(undefined);
    const comment = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => null;
    const item = makeItem('4', 'Depends on external/repo#5');

    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel, forceState, comment),
    });

    expect(result.unregistered[0].externalId).toBe('4');
    expect(result.eligible).toHaveLength(0);
    expect(setLabel).not.toHaveBeenCalled();
    expect(forceState).toHaveBeenCalledWith('4', 'factory:needs-human');
    expect(comment).toHaveBeenCalledWith('4', expect.stringContaining('external/repo#5'));
  });

  it('already-escalated unregistered dep → no re-escalation on repeat tick', async () => {
    const setLabel = vi.fn();
    const forceState = vi.fn().mockResolvedValue(undefined);
    const comment = vi.fn().mockResolvedValue(undefined);
    const fetchTarget: FetchTargetFn = async () => null;
    const item = makeItem('5', 'Depends on external/repo#5');
    item.state = 'factory:needs-human';

    const result = await filterEligibleByDependencies([item], {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel, forceState, comment),
    });

    expect(result.unregistered[0].externalId).toBe('5');
    expect(forceState).not.toHaveBeenCalled();
    expect(comment).not.toHaveBeenCalled();
  });

  it('mixed sprint batch — eligible / blocked / unregistered partitioned correctly', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const items = [
      makeItem('10', 'No deps'),
      makeItem('11', 'Depends on #20'),
      makeItem('12', 'Depends on nowhere/repo#1'),
      makeItem('13', 'Depends on #21\nDepends on #22'),
    ];

    const fetchTarget: FetchTargetFn = async (repo, num) => {
      if (repo === 'nowhere/repo') return null;
      if (num === 20) return { state: 'open', title: 'Open 20' };
      if (num === 21) return { state: 'closed', title: 'Done 21' };
      if (num === 22) return { state: 'open', title: 'Open 22' };
      return { state: 'closed', title: 'Fallback' };
    };

    const result = await filterEligibleByDependencies(items, {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });

    expect(result.eligible.map((i) => i.externalId)).toEqual(['10']);
    expect(result.blocked.map((i) => i.externalId).sort()).toEqual(['11', '13']);
    expect(result.unregistered.map((i) => i.externalId)).toEqual(['12']);
  });

  it('parallel non-conflicting issues both eligible when deps satisfied', async () => {
    const setLabel = vi.fn().mockResolvedValue(undefined);
    const items = [makeItem('50', 'Depends on #60'), makeItem('51', 'Depends on #61')];

    const fetchTarget: FetchTargetFn = async (_repo, num) => ({
      state: 'closed',
      title: `Done ${num}`,
    });

    const result = await filterEligibleByDependencies(items, {
      currentRepo,
      fetchTarget,
      source: makeSource(setLabel),
    });

    expect(result.eligible).toHaveLength(2);
    expect(result.blocked).toHaveLength(0);
    expect(setLabel).not.toHaveBeenCalled();
  });
});
