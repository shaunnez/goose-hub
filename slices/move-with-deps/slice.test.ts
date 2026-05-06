import { moveIssueToCurrent } from '@goose-hub/core/projects/move-with-deps.js';
import type { FetchLifecycleFn, SetScheduleFn } from '@goose-hub/core/projects/move-with-deps.js';
import { describe, expect, it, vi } from 'vitest';

const REPO = 'shaunnez/goose-hub';
const ISSUE = 100;

describe('move-with-deps slice — moveIssueToCurrent', () => {
  it('no deps → moves issue only; fetchLifecycle never called', async () => {
    const fetchLifecycle = vi.fn<FetchLifecycleFn>();
    const setSchedule = vi.fn<SetScheduleFn>().mockResolvedValue(undefined);

    const result = await moveIssueToCurrent(
      'No dependencies here.',
      REPO,
      ISSUE,
      'with-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    expect(fetchLifecycle).not.toHaveBeenCalled();
    expect(setSchedule).toHaveBeenCalledOnce();
    expect(setSchedule).toHaveBeenCalledWith(REPO, ISSUE, 'current');
    expect(result.depsMoved).toHaveLength(0);
    expect(result.depsSkipped).toHaveLength(0);
  });

  it('all deps closed → moves issue only; closed deps in depsSkipped', async () => {
    const fetchLifecycle = vi.fn<FetchLifecycleFn>().mockResolvedValue('closed');
    const setSchedule = vi.fn<SetScheduleFn>().mockResolvedValue(undefined);

    const result = await moveIssueToCurrent(
      'Depends on #50\nDepends on #51',
      REPO,
      ISSUE,
      'with-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    expect(setSchedule).toHaveBeenCalledOnce();
    expect(setSchedule).toHaveBeenCalledWith(REPO, ISSUE, 'current');
    expect(result.depsMoved).toHaveLength(0);
    expect(result.depsSkipped).toHaveLength(2);
    expect(result.depsSkipped.map((d) => d.issueNumber).sort()).toEqual([50, 51]);
  });

  it('open deps + with-dependencies → moves issue and all open deps', async () => {
    const fetchLifecycle = vi.fn<FetchLifecycleFn>().mockResolvedValue('open');
    const setSchedule = vi.fn<SetScheduleFn>().mockResolvedValue(undefined);

    const result = await moveIssueToCurrent(
      'Depends on #50\nDepends on #51',
      REPO,
      ISSUE,
      'with-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    // setSchedule: dep #50, dep #51, then the issue itself
    expect(setSchedule).toHaveBeenCalledTimes(3);
    expect(setSchedule).toHaveBeenCalledWith(REPO, 50, 'current');
    expect(setSchedule).toHaveBeenCalledWith(REPO, 51, 'current');
    expect(setSchedule).toHaveBeenCalledWith(REPO, ISSUE, 'current');
    expect(result.depsMoved).toHaveLength(2);
    expect(result.depsSkipped).toHaveLength(0);
  });

  it('open deps + ignore-dependencies → moves issue only; open deps in depsSkipped', async () => {
    const fetchLifecycle = vi.fn<FetchLifecycleFn>().mockResolvedValue('open');
    const setSchedule = vi.fn<SetScheduleFn>().mockResolvedValue(undefined);

    const result = await moveIssueToCurrent(
      'Depends on #50',
      REPO,
      ISSUE,
      'ignore-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    expect(setSchedule).toHaveBeenCalledOnce();
    expect(setSchedule).toHaveBeenCalledWith(REPO, ISSUE, 'current');
    expect(result.depsMoved).toHaveLength(0);
    expect(result.depsSkipped).toHaveLength(1);
    expect(result.depsSkipped[0].issueNumber).toBe(50);
  });

  it('mixed open+closed deps + with-dependencies → only open deps moved', async () => {
    const fetchLifecycle = vi
      .fn<FetchLifecycleFn>()
      .mockImplementation(async (_repo, num) => (num === 50 ? 'closed' : 'open'));
    const setSchedule = vi.fn<SetScheduleFn>().mockResolvedValue(undefined);

    const result = await moveIssueToCurrent(
      'Depends on #50\nDepends on #51',
      REPO,
      ISSUE,
      'with-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    // #50 closed (skipped), #51 open (moved), issue moved
    expect(setSchedule).toHaveBeenCalledTimes(2);
    expect(setSchedule).toHaveBeenCalledWith(REPO, 51, 'current');
    expect(setSchedule).toHaveBeenCalledWith(REPO, ISSUE, 'current');
    expect(result.depsMoved).toHaveLength(1);
    expect(result.depsMoved[0].issueNumber).toBe(51);
    expect(result.depsSkipped).toHaveLength(1);
    expect(result.depsSkipped[0].issueNumber).toBe(50);
  });

  it('cross-repo dep → repoRef used for fetch and setSchedule', async () => {
    const fetchLifecycle = vi.fn<FetchLifecycleFn>().mockResolvedValue('open');
    const setSchedule = vi.fn<SetScheduleFn>().mockResolvedValue(undefined);

    const result = await moveIssueToCurrent(
      'Depends on other-owner/other-repo#77',
      REPO,
      ISSUE,
      'with-dependencies',
      fetchLifecycle,
      setSchedule,
    );

    expect(fetchLifecycle).toHaveBeenCalledWith('other-owner/other-repo', 77);
    expect(setSchedule).toHaveBeenCalledWith('other-owner/other-repo', 77, 'current');
    expect(setSchedule).toHaveBeenCalledWith(REPO, ISSUE, 'current');
    expect(result.depsMoved[0].repoRef).toBe('other-owner/other-repo');
  });
});
