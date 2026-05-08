import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn() },
}));

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
}));

vi.mock('../../shared/resolve-milestone.js', () => ({
  resolveActiveMilestone: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  writeActiveMilestone: vi.fn().mockResolvedValue(undefined),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import { writeActiveMilestone } from './repository.js';
import {
  createMilestone,
  deleteMilestone,
  getActiveMilestone,
  getSprintReviewEligibility,
  listClosedMilestoneIssues,
  listMilestoneIssues,
  listMilestones,
  setActiveMilestone,
  updateMilestone,
} from './service.js';

const mockSource = {
  getActiveMilestone: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
  listWorkByMilestone: vi.fn().mockResolvedValue([]),
  listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
  vi.mocked(resolveActiveMilestone).mockResolvedValue({
    milestoneNumber: null,
    source: 'github-default',
  });
});

describe('getActiveMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getActiveMilestone('unknown');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns project_state milestone', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: 5,
      source: 'project_state',
    });
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({ ok: true, data: { milestoneNumber: 5, source: 'project_state' } });
  });

  it('returns config-derived milestone', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: 10,
      source: 'config',
    });
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({ ok: true, data: { milestoneNumber: 10, source: 'config' } });
  });

  it('falls back to github-default when no persisted or config milestone', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: 3,
      source: 'github-default',
    });
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({
      ok: true,
      data: { milestoneNumber: 3, source: 'github-default' },
    });
  });

  it('returns null milestoneNumber when github has no active milestone', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: null,
      source: 'github-default',
    });
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({
      ok: true,
      data: { milestoneNumber: null, source: 'github-default' },
    });
  });
});

describe('setActiveMilestone', () => {
  it('writes milestone and emits event', async () => {
    const result = await setActiveMilestone('my-proj', 7);
    expect(result).toEqual({ ok: true, data: { ok: true, milestoneNumber: 7 } });
    expect(writeActiveMilestone).toHaveBeenCalledWith('my-proj', 7, 'ui');
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
      { number: 1, title: 'M1: State Machine' },
      { number: 2, title: 'M2: Chrome' },
    ]);
    const result = await listMilestones('my-proj');
    expect(result).toEqual({
      ok: true,
      data: {
        milestones: [
          { number: 1, title: 'M1: State Machine' },
          { number: 2, title: 'M2: Chrome' },
        ],
      },
    });
  });

  it('filters out non-M-prefixed milestones (e.g. E2E)', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 10, title: 'M1: State Machine' },
      { number: 20, title: 'E2E: End-to-End Tests' },
      { number: 30, title: 'M3: Inbox' },
      { number: 40, title: 'Internal Tooling' },
    ]);
    const result = await listMilestones('my-proj');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const titles = (result.data.milestones as Array<{ title: string }>).map((m) => m.title);
    expect(titles).toEqual(['M1: State Machine', 'M3: Inbox']);
    expect(titles).not.toContain('E2E: End-to-End Tests');
    expect(titles).not.toContain('Internal Tooling');
  });

  it('sorts milestones numerically by M-number ascending', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 30, title: 'M10: Analytics' },
      { number: 10, title: 'M2: Chrome' },
      { number: 20, title: 'M1: State Machine' },
    ]);
    const result = await listMilestones('my-proj');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const titles = (result.data.milestones as Array<{ title: string }>).map((m) => m.title);
    expect(titles).toEqual(['M1: State Machine', 'M2: Chrome', 'M10: Analytics']);
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

describe('createMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await createMilestone('unknown', 'M14: Sprint');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 422 for non-M-prefixed title', async () => {
    const result = await createMilestone('my-proj', 'Freeform Title');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
  });

  it('returns 422 when title has no name after colon', async () => {
    const result = await createMilestone('my-proj', 'M14: ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
  });

  it('creates milestone and returns it', async () => {
    const created = {
      id: '14',
      number: 14,
      title: 'M14: Sprint',
      state: 'open',
      openIssues: 0,
      closedIssues: 0,
      isActive: true,
    };
    mockSource.createMilestone.mockResolvedValueOnce(created);
    const result = await createMilestone('my-proj', 'M14: Sprint');
    expect(result).toEqual({ ok: true, data: { milestone: created } });
    expect(mockSource.createMilestone).toHaveBeenCalledWith('M14: Sprint');
  });
});

describe('updateMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await updateMilestone('unknown', 14, { title: 'M14: New Name' });
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 422 when renaming to non-M-prefixed title', async () => {
    const result = await updateMilestone('my-proj', 14, { title: 'Bad Title' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
  });

  it('allows state-only update without title validation', async () => {
    const updated = {
      id: '14',
      number: 14,
      title: 'M14: Sprint',
      state: 'closed',
      openIssues: 0,
      closedIssues: 5,
      isActive: false,
    };
    mockSource.updateMilestone.mockResolvedValueOnce(updated);
    const result = await updateMilestone('my-proj', 14, { state: 'closed' });
    expect(result).toEqual({ ok: true, data: { milestone: updated } });
  });

  it('updates milestone and returns it', async () => {
    const updated = {
      id: '14',
      number: 14,
      title: 'M14: New Name',
      state: 'open',
      openIssues: 0,
      closedIssues: 0,
      isActive: true,
    };
    mockSource.updateMilestone.mockResolvedValueOnce(updated);
    const result = await updateMilestone('my-proj', 14, { title: 'M14: New Name' });
    expect(result).toEqual({ ok: true, data: { milestone: updated } });
    expect(mockSource.updateMilestone).toHaveBeenCalledWith(14, { title: 'M14: New Name' });
  });
});

describe('deleteMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await deleteMilestone('unknown', 14);
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 404 when milestone not found in list', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 13, title: 'M13', state: 'open', openIssues: 0, closedIssues: 0 },
    ]);
    const result = await deleteMilestone('my-proj', 14);
    expect(result).toEqual({ ok: false, error: 'milestone not found', status: 404 });
  });

  it('returns 409 when milestone has issues', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 14, title: 'M14', state: 'open', openIssues: 3, closedIssues: 0 },
    ]);
    const result = await deleteMilestone('my-proj', 14);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/has issues/i);
  });

  it('returns 409 when milestone is currently active', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 14, title: 'M14', state: 'open', openIssues: 0, closedIssues: 0 },
    ]);
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: 14,
      source: 'project_state',
    });
    const result = await deleteMilestone('my-proj', 14);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/active/i);
  });

  it('deletes milestone when empty and not active', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 14, title: 'M14', state: 'open', openIssues: 0, closedIssues: 0 },
    ]);
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: null,
      source: 'project_state',
    });
    const result = await deleteMilestone('my-proj', 14);
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(mockSource.deleteMilestone).toHaveBeenCalledWith(14);
  });
});

describe('getSprintReviewEligibility', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getSprintReviewEligibility('unknown', 5);
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 404 when milestone not found in list', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([]);
    const result = await getSprintReviewEligibility('my-proj', 99);
    expect(result).toEqual({ ok: false, error: 'milestone not found', status: 404 });
  });

  it('returns eligibility for known milestone', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 5, title: 'M5: Sprint', state: 'open', openIssues: 0, closedIssues: 0 },
    ]);
    mockSource.listWorkByMilestone.mockResolvedValueOnce([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
    ]);
    const result = await getSprintReviewEligibility('my-proj', 5);
    expect(result).toEqual({
      ok: true,
      data: { eligible: true, reason: '', alreadyExists: false },
    });
  });
});
