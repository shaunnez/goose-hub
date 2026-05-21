import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('./enhance.js', () => ({
  runBugEnhance: vi.fn(),
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }),
  },
}));

import { dispatchTriageBatch } from '#shared/dispatch.js';
import { getSourceForSlug } from '#shared/source.js';
import { runBugEnhance } from './enhance.js';
import { deleteInboxItem, getInboxItem, insertInboxItem, listInboxItems } from './repository.js';
import {
  createInboxItem,
  deleteInboxItem as deleteInboxItemService,
  getInboxItems,
  promoteInboxItem,
} from './service.js';

const mockItem = { id: 1, title: 'Fix bug', body: '', type: 'bug', createdAt: '2026-05-01' };
const mockSource = { createIssue: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  mockSource.createIssue.mockResolvedValue(undefined);
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
  vi.mocked(runBugEnhance).mockResolvedValue(null);
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

  it('runs enhancement for bug promotions when requested and appends the returned markdown', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce({
      id: 4,
      title: 'Fix bug',
      body: 'Original bug body',
      type: 'bug',
      createdAt: '2026-05-01',
    });
    vi.mocked(runBugEnhance).mockResolvedValueOnce('## AI analysis');

    await promoteInboxItem(4, 'my-proj', undefined, true);

    expect(runBugEnhance).toHaveBeenCalledWith(
      expect.anything(),
      4,
      'Fix bug',
      'Original bug body',
    );
    expect(mockSource.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Original bug body\n\n---\n\n## AI analysis' }),
    );
  });

  it.each([
    ['feature', 'Feature body'],
    ['chore', 'Chore body'],
    ['research', 'Research body'],
  ] as const)(
    'runs enhancement for %s promotions when requested and appends the returned markdown',
    async (type, body) => {
      vi.mocked(getInboxItem).mockResolvedValueOnce({
        id: 5,
        title: `${type} title`,
        body,
        type,
        createdAt: '2026-05-01',
      });
      vi.mocked(runBugEnhance).mockResolvedValueOnce(`Enhanced ${type}`);

      await promoteInboxItem(5, 'my-proj', undefined, true);

      expect(runBugEnhance).toHaveBeenCalledWith(expect.anything(), 5, `${type} title`, body);
      expect(mockSource.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ type, body: `${body}\n\n---\n\nEnhanced ${type}` }),
      );
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
