import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunBugEnhance } = vi.hoisted(() => ({
  mockRunBugEnhance: vi.fn(),
}));

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
}));

vi.mock('../../shared/dispatch.js', () => ({
  dispatchTriageBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repository.js', () => ({
  insertInboxItem: vi.fn(),
  listInboxItems: vi.fn().mockResolvedValue([]),
  getInboxItem: vi.fn(),
  deleteInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }),
  },
}));

vi.mock('./enhance.js', () => ({
  runBugEnhance: mockRunBugEnhance,
}));

import { dispatchTriageBatch } from '#shared/dispatch.js';
import { getSourceForSlug } from '#shared/source.js';
import { deleteInboxItem, getInboxItem, insertInboxItem, listInboxItems } from './repository.js';
import {
  createInboxItem,
  deleteInboxItem as deleteInboxItemService,
  getInboxItems,
  promoteInboxItem,
} from './service.js';

const mockItem = { id: 1, title: 'Fix bug', body: '', type: 'bug', createdAt: '2026-05-01' };
const mockSource = {
  projectId: 'project-123',
  createIssue: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
  mockRunBugEnhance.mockResolvedValue('**Expected**\nEnhanced output');
});

describe('createInboxItem', () => {
  it('returns 400 when title is missing', async () => {
    const result = await createInboxItem(undefined, undefined, undefined);
    expect(result).toEqual({ ok: false, error: 'title is required', status: 400 });
  });

  it('returns 400 when title is whitespace-only', async () => {
    const result = await createInboxItem('   ', undefined, undefined);
    expect(result).toEqual({ ok: false, error: 'title is required', status: 400 });
  });

  it('defaults type to feature for unknown type', async () => {
    vi.mocked(insertInboxItem).mockResolvedValueOnce(mockItem);
    await createInboxItem('Some title', '', 'invalid-type');
    expect(insertInboxItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'feature' }));
  });

  it('uses provided valid type', async () => {
    vi.mocked(insertInboxItem).mockResolvedValueOnce(mockItem);
    await createInboxItem('Fix this', '', 'bug');
    expect(insertInboxItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'bug' }));
  });

  it('trims title before insert', async () => {
    vi.mocked(insertInboxItem).mockResolvedValueOnce(mockItem);
    await createInboxItem('  My Title  ', '', 'feature');
    expect(insertInboxItem).toHaveBeenCalledWith(expect.objectContaining({ title: 'My Title' }));
  });
});

describe('getInboxItems', () => {
  it('returns all items', async () => {
    vi.mocked(listInboxItems).mockResolvedValueOnce([mockItem]);
    const result = await getInboxItems();
    expect(result).toEqual({ ok: true, data: { items: [mockItem] } });
  });
});

describe('promoteInboxItem', () => {
  it('returns 404 when item not found', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(null);
    const result = await promoteInboxItem(999, 'my-proj');
    expect(result).toEqual({ ok: false, error: 'not found', status: 404 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(mockItem);
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await promoteInboxItem(1, 'unknown');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
    expect(dispatchTriageBatch).not.toHaveBeenCalled();
  });

  it('creates github issue and deletes inbox item on success', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(mockItem);
    const result = await promoteInboxItem(1, 'my-proj');
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(mockSource.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix bug' }),
    );
    expect(deleteInboxItem).toHaveBeenCalledWith(1);
    expect(dispatchTriageBatch).toHaveBeenCalledWith('my-proj');
  });

  it('does not delete inbox item or dispatch triage when createIssue fails', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(mockItem);
    mockSource.createIssue.mockRejectedValueOnce(new Error('github unavailable'));

    await expect(promoteInboxItem(1, 'my-proj')).rejects.toThrow('github unavailable');
    expect(deleteInboxItem).not.toHaveBeenCalled();
    expect(dispatchTriageBatch).not.toHaveBeenCalled();
  });

  it('still returns ok:true when deleteInboxItem throws (GitHub issue was created)', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(mockItem);
    vi.mocked(deleteInboxItem).mockRejectedValueOnce(new Error('DB locked'));

    const result = await promoteInboxItem(1, 'my-proj');
    // The GitHub issue was created; delete failure is logged but swallowed
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(mockSource.createIssue).toHaveBeenCalled();
  });

  it('creates issue with type from item', async () => {
    const researchItem = {
      id: 2,
      title: 'Research X',
      body: 'Details',
      type: 'research',
      createdAt: '2026-05-01',
    };
    vi.mocked(getInboxItem).mockResolvedValueOnce(researchItem);
    await promoteInboxItem(2, 'my-proj');
    expect(mockSource.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'research', title: 'Research X' }),
    );
  });

  it('defaults body to empty string when item body is falsy', async () => {
    const itemWithNullBody = {
      id: 3,
      title: 'No body',
      body: null as unknown as string,
      type: 'chore',
      createdAt: '2026-05-01',
    };
    vi.mocked(getInboxItem).mockResolvedValueOnce(itemWithNullBody);
    await promoteInboxItem(3, 'my-proj');
    expect(mockSource.createIssue).toHaveBeenCalledWith(expect.objectContaining({ body: '' }));
  });

  it('bypasses enhancement when enhance is false', async () => {
    const item = {
      id: 4,
      title: 'Feature idea',
      body: 'Original body',
      type: 'feature',
      createdAt: '2026-05-01',
    };

    vi.mocked(getInboxItem).mockResolvedValueOnce(item);
    await promoteInboxItem(4, 'my-proj', undefined, false);

    expect(mockRunBugEnhance).not.toHaveBeenCalled();
    expect(mockSource.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Original body', type: 'feature' }),
    );
  });

  it.each(['bug', 'feature', 'chore', 'research'] as const)(
    'dispatches enhancement for supported type %s when enhance is true',
    async (type) => {
      const item = {
        id: 5,
        title: `${type} title`,
        body: `${type} body`,
        type,
        createdAt: '2026-05-01',
      };

      vi.mocked(getInboxItem).mockResolvedValueOnce(item);
      await promoteInboxItem(5, 'my-proj', undefined, true);

      expect(mockRunBugEnhance).toHaveBeenCalledWith(
        mockSource.projectId,
        5,
        `${type} title`,
        `${type} body`,
        type,
      );
      expect(mockSource.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          body: `${type} body\n\n---\n\n**Expected**\nEnhanced output`,
        }),
      );
    },
  );

  it.each([
    ['missing', undefined],
    ['unsupported', 'epic'],
  ])('returns 400 before enhancement for %s type when enhance is true', async (_label, type) => {
    const item = {
      id: 6,
      title: 'Bad type',
      body: 'Original body',
      type,
      createdAt: '2026-05-01',
    };

    vi.mocked(getInboxItem).mockResolvedValueOnce(item as never);
    const result = await promoteInboxItem(6, 'my-proj', undefined, true);

    expect(result).toEqual({ ok: false, error: 'invalid promotion type', status: 400 });
    expect(mockRunBugEnhance).not.toHaveBeenCalled();
    expect(mockSource.createIssue).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['unsupported', 'epic'],
  ])(
    'returns 400 before issue creation for %s type when enhance is false',
    async (_label, type) => {
      const item = {
        id: 7,
        title: 'Bad type',
        body: 'Original body',
        type,
        createdAt: '2026-05-01',
      };

      vi.mocked(getInboxItem).mockResolvedValueOnce(item as never);
      const result = await promoteInboxItem(7, 'my-proj', undefined, false);

      expect(result).toEqual({ ok: false, error: 'invalid promotion type', status: 400 });
      expect(mockRunBugEnhance).not.toHaveBeenCalled();
      expect(mockSource.createIssue).not.toHaveBeenCalled();
    },
  );
});

describe('deleteInboxItem (service)', () => {
  it('returns 404 when item not found', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(null);
    const result = await deleteInboxItemService(999);
    expect(result).toEqual({ ok: false, error: 'not found', status: 404 });
    expect(deleteInboxItem).not.toHaveBeenCalled();
  });

  it('returns ok:true and calls repository delete when item exists', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(mockItem);
    vi.mocked(deleteInboxItem).mockResolvedValueOnce(undefined);
    const result = await deleteInboxItemService(1);
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(deleteInboxItem).toHaveBeenCalledWith(1);
  });
});
