import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunPromotionEnhance } = vi.hoisted(() => ({
  mockRunPromotionEnhance: vi.fn(),
}));

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
}));

vi.mock('../../shared/dispatch.js', () => ({
  dispatchTriageBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repository.js', () => ({
  getInboxItem: vi.fn(),
  deleteInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./enhance.js', () => ({
  isSupportedPromotionType: (type: string | null | undefined) =>
    ['feature', 'bug', 'chore', 'research'].includes(type ?? ''),
  runPromotionEnhance: mockRunPromotionEnhance,
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }),
  },
}));

import { dispatchTriageBatch } from '#shared/dispatch.js';
import { getSourceForSlug } from '#shared/source.js';
import { runPromotionEnhance } from './enhance.js';
import { deleteInboxItem, getInboxItem } from './repository.js';
import { promoteInboxItem } from './service.js';

const mockSource = { createIssue: vi.fn().mockResolvedValue(undefined), projectId: 'project-123' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSource.createIssue.mockReset();
  mockSource.createIssue.mockResolvedValue(undefined);
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
  vi.mocked(runPromotionEnhance).mockResolvedValue('## Enhanced proposal');
});

describe('inbox promotion slice', () => {
  it.each(['feature', 'chore', 'research'] as const)(
    'routes supported %s promotions through enhancement and cleanup',
    async (type) => {
      vi.mocked(getInboxItem).mockResolvedValueOnce({
        id: 10,
        title: `${type} title`,
        body: `${type} body`,
        type,
        createdAt: '2026-05-01',
      } as never);

      const result = await promoteInboxItem(10, 'my-proj', undefined, true);

      expect(result).toEqual({ ok: true, data: { ok: true } });
      expect(runPromotionEnhance).toHaveBeenCalledWith(
        'project-123',
        10,
        type,
        `${type} title`,
        `${type} body`,
      );
      expect(mockSource.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ body: '## Enhanced proposal', type }),
      );
      expect(dispatchTriageBatch).toHaveBeenCalledWith('my-proj');
      expect(deleteInboxItem).toHaveBeenCalledWith(10);
    },
  );

  it('keeps the original body when enhancement is disabled', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce({
      id: 11,
      title: 'Research title',
      body: 'Original body',
      type: 'research',
      createdAt: '2026-05-01',
    } as never);

    const result = await promoteInboxItem(11, 'my-proj', undefined, false);

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(runPromotionEnhance).not.toHaveBeenCalled();
    expect(mockSource.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Original body', type: 'research' }),
    );
  });

  it('rejects unsupported types before enhancement starts', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce({
      id: 12,
      title: 'Unsupported title',
      body: 'Original body',
      type: 'incident',
      createdAt: '2026-05-01',
    } as never);

    await expect(promoteInboxItem(12, 'my-proj', undefined, true)).resolves.toEqual({
      ok: false,
      error: 'unsupported promotion type',
      status: 400,
    });
    expect(runPromotionEnhance).not.toHaveBeenCalled();
    expect(mockSource.createIssue).not.toHaveBeenCalled();
    expect(dispatchTriageBatch).not.toHaveBeenCalled();
    expect(deleteInboxItem).not.toHaveBeenCalled();
  });
});
