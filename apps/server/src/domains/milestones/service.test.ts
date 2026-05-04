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
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 1, title: 'M1: State Enum' },
      { number: 2, title: 'M2: Chrome' },
    ]);
    const result = await listMilestones('my-proj');
    expect(result).toMatchObject({
      ok: true,
      data: {
        milestones: [
          { number: 1, title: 'M1: State Enum' },
          { number: 2, title: 'M2: Chrome' },
        ],
      },
    });
  });

  it('filters out non-M milestones (e.g. E2E)', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 1, title: 'M1: State Enum' },
      { number: 99, title: 'E2E: End-to-End Tests' },
      { number: 3, title: 'M3: Inbox' },
    ]);
    const result = await listMilestones('my-proj');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const titles = result.data.milestones.map((m) => (m as { title: string }).title);
    expect(titles).toEqual(['M1: State Enum', 'M3: Inbox']);
    expect(titles).not.toContain('E2E: End-to-End Tests');
  });

  it('sorts M-milestones in ascending numeric order', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 9, title: 'M9: Retrospective' },
      { number: 1, title: 'M1: State Enum' },
      { number: 5, title: 'M5: Roster' },
      { number: 3, title: 'M3: Inbox' },
    ]);
    const result = await listMilestones('my-proj');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const numbers = result.data.milestones.map((m) => (m as { number: number }).number);
    expect(numbers).toEqual([1, 3, 5, 9]);
  });

  it('filters and sorts in one pass: removes non-M and orders remaining', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 5, title: 'M5: Roster' },
      { number: 99, title: 'E2E: Testing' },
      { number: 1, title: 'M1: State Enum' },
      { number: 98, title: 'Infra: Setup' },
      { number: 3, title: 'M3: Inbox' },
    ]);
    const result = await listMilestones('my-proj');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const titles = result.data.milestones.map((m) => (m as { title: string }).title);
    expect(titles).toEqual(['M1: State Enum', 'M3: Inbox', 'M5: Roster']);
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
