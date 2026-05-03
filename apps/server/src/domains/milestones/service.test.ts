import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn() },
}));

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
}));

vi.mock('../../shared/cache.js', () => ({
  getCached: vi.fn().mockImplementation((_key, _ttl, fetcher) => fetcher()),
  bustCache: vi.fn(),
  CACHE_KEY: {
    issues: (s: string) => `issues:${s}`,
    milestones: (s: string) => `milestones:${s}`,
    closedIssues: (s: string, m: number) => `closed-issues:${s}:${m}`,
    milestoneIssues: (s: string, m: number) => `milestone-issues:${s}:${m}`,
  },
}));

vi.mock('./repository.js', () => ({
  readActiveMilestone: vi.fn().mockResolvedValue(null),
  writeActiveMilestone: vi.fn().mockResolvedValue(undefined),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { bustCache } from '../../shared/cache.js';
import { getSourceForSlug } from '../../shared/source.js';
import { readActiveMilestone, writeActiveMilestone } from './repository.js';
import {
  getActiveMilestone,
  listClosedMilestoneIssues,
  listMilestoneIssues,
  listMilestones,
  setActiveMilestone,
} from './service.js';

const mockSource = {
  getActiveMilestone: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
  listWorkByMilestone: vi.fn().mockResolvedValue([]),
  listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
});

describe('getActiveMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getActiveMilestone('unknown');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns persisted milestone when one exists', async () => {
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(5);
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({ ok: true, data: { milestoneNumber: 5, source: 'project_state' } });
  });

  it('falls back to github-default when no persisted milestone', async () => {
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(null);
    mockSource.getActiveMilestone.mockResolvedValueOnce({ number: 3 });
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({
      ok: true,
      data: { milestoneNumber: 3, source: 'github-default' },
    });
  });

  it('returns null milestoneNumber when github has no active milestone', async () => {
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(null);
    mockSource.getActiveMilestone.mockResolvedValueOnce(null);
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({
      ok: true,
      data: { milestoneNumber: null, source: 'github-default' },
    });
  });
});

describe('setActiveMilestone', () => {
  it('writes milestone, busts cache, and emits event', async () => {
    const result = await setActiveMilestone('my-proj', 7);
    expect(result).toEqual({ ok: true, data: { ok: true, milestoneNumber: 7 } });
    expect(writeActiveMilestone).toHaveBeenCalledWith('my-proj', 7, 'ui');
    expect(bustCache).toHaveBeenCalled();
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'milestone.activated', payload: { milestoneNumber: 7 } }),
    );
  });

  it('returns 404 for unknown project (#196)', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await setActiveMilestone('unknown', 7);
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
    expect(writeActiveMilestone).not.toHaveBeenCalled();
    expect(eventStore.appendEvent).not.toHaveBeenCalled();
  });
});

describe('listMilestones', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listMilestones('unknown');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns milestones list', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([{ number: 1 }, { number: 2 }]);
    const result = await listMilestones('my-proj');
    expect(result).toEqual({ ok: true, data: { milestones: [{ number: 1 }, { number: 2 }] } });
  });
});

describe('listMilestoneIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listMilestoneIssues('unknown', 3);
    expect(result.ok).toBe(false);
  });

  it('returns items for known project and milestone', async () => {
    mockSource.listWorkByMilestone.mockResolvedValueOnce([{ id: 'github:owner/repo#1' }]);
    const result = await listMilestoneIssues('my-proj', 3);
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#1' }] } });
  });
});

describe('listClosedMilestoneIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listClosedMilestoneIssues('unknown', 3);
    expect(result.ok).toBe(false);
  });

  it('returns closed items', async () => {
    mockSource.listClosedWorkByMilestone.mockResolvedValueOnce([{ id: 'github:owner/repo#5' }]);
    const result = await listClosedMilestoneIssues('my-proj', 3);
    expect(result).toMatchObject({
      ok: true,
      data: { items: [{ id: 'github:owner/repo#5' }] },
    });
  });
});
