import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/db/db.js', () => ({ db: { select: vi.fn() } }));
vi.mock('@goose-hub/core/db/schema.js', () => ({ projectState: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('./projects.js', () => ({ getProject: vi.fn() }));
vi.mock('./source.js', () => ({ getSourceForSlug: vi.fn() }));

import { db } from '@goose-hub/core/db/db.js';
import { getProject } from './projects.js';
import { resetConfigMilestoneCache, resolveActiveMilestone } from './resolve-milestone.js';
import { getSourceForSlug } from './source.js';

const mockSource = {
  listMilestones: vi.fn(),
  getActiveMilestone: vi.fn(),
};

function mockDbRows(rows: { activeMilestoneNumber: number | null }[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnValue(rows),
  };
  vi.mocked(db).select = vi.fn().mockReturnValue(chain);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetConfigMilestoneCache();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
  vi.mocked(getProject).mockResolvedValue(null);
});

describe('resolveActiveMilestone', () => {
  describe('priority 1: project_state row', () => {
    it('returns project_state number when a row exists with a milestone', async () => {
      mockDbRows([{ activeMilestoneNumber: 7 }]);
      const result = await resolveActiveMilestone('my-proj');
      expect(result).toEqual({ milestoneNumber: 7, source: 'project_state' });
    });

    it('returns null from project_state when row has null milestone (explicit no-filter)', async () => {
      mockDbRows([{ activeMilestoneNumber: null }]);
      const result = await resolveActiveMilestone('my-proj');
      expect(result).toEqual({ milestoneNumber: null, source: 'project_state' });
    });

    it('does not call getProject when a project_state row exists', async () => {
      mockDbRows([{ activeMilestoneNumber: 3 }]);
      await resolveActiveMilestone('my-proj');
      expect(vi.mocked(getProject)).not.toHaveBeenCalled();
    });
  });

  describe('priority 2: ProjectConfig.activeMilestone title', () => {
    it('resolves config title to milestone number via listMilestones', async () => {
      mockDbRows([]);
      vi.mocked(getProject).mockResolvedValue({
        activeMilestone: 'M10: Multi-project Orchestration',
      } as never);
      mockSource.listMilestones.mockResolvedValue([
        { number: 9, title: 'M9: Retro' },
        { number: 10, title: 'M10: Multi-project Orchestration' },
      ]);
      const result = await resolveActiveMilestone('my-proj');
      expect(result).toEqual({ milestoneNumber: 10, source: 'config' });
    });

    it('returns null when config title has no matching GitHub milestone', async () => {
      mockDbRows([]);
      vi.mocked(getProject).mockResolvedValue({
        activeMilestone: 'M99: Does Not Exist',
      } as never);
      mockSource.listMilestones.mockResolvedValue([{ number: 1, title: 'M1: Foundation' }]);
      const result = await resolveActiveMilestone('my-proj');
      expect(result).toEqual({ milestoneNumber: null, source: 'config' });
    });

    it('caches the resolved number so listMilestones is only called once per title', async () => {
      mockDbRows([]);
      vi.mocked(getProject).mockResolvedValue({
        activeMilestone: 'M10: Multi-project Orchestration',
      } as never);
      mockSource.listMilestones.mockResolvedValue([
        { number: 10, title: 'M10: Multi-project Orchestration' },
      ]);
      await resolveActiveMilestone('proj-a');
      await resolveActiveMilestone('proj-a');
      expect(mockSource.listMilestones).toHaveBeenCalledTimes(1);
    });

    it('caches per slug — two projects with different milestones stay independent', async () => {
      mockDbRows([]);
      vi.mocked(getProject)
        .mockResolvedValueOnce({ activeMilestone: 'M10: Orchestration' } as never)
        .mockResolvedValueOnce({ activeMilestone: 'M5: Foundation' } as never);
      mockSource.listMilestones
        .mockResolvedValueOnce([{ number: 10, title: 'M10: Orchestration' }])
        .mockResolvedValueOnce([{ number: 5, title: 'M5: Foundation' }]);

      const r1 = await resolveActiveMilestone('proj-a');
      const r2 = await resolveActiveMilestone('proj-b');

      expect(r1).toEqual({ milestoneNumber: 10, source: 'config' });
      expect(r2).toEqual({ milestoneNumber: 5, source: 'config' });
    });
  });

  describe('priority 3: GitHub default', () => {
    it('falls back to GitHub active milestone when no project_state row and no config title', async () => {
      mockDbRows([]);
      vi.mocked(getProject).mockResolvedValue({ activeMilestone: undefined } as never);
      mockSource.getActiveMilestone.mockResolvedValue({ number: 3, title: 'M3: Inbox' });
      const result = await resolveActiveMilestone('my-proj');
      expect(result).toEqual({ milestoneNumber: 3, source: 'github-default' });
    });

    it('returns null when GitHub has no active milestone', async () => {
      mockDbRows([]);
      vi.mocked(getProject).mockResolvedValue(null);
      mockSource.getActiveMilestone.mockResolvedValue(null);
      const result = await resolveActiveMilestone('my-proj');
      expect(result).toEqual({ milestoneNumber: null, source: 'github-default' });
    });
  });
});
