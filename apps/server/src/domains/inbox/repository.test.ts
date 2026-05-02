import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInboxRow = {
  id: 1,
  title: 'Test idea',
  body: '',
  type: 'feature',
  createdAt: '2026-05-01 00:00:00',
};

const { mockSelect, mockInsert, mockDelete } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

vi.mock('@goose-hub/core/db/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@goose-hub/core/db/schema.js')>();
  return { ...actual };
});

import { deleteInboxItem, getInboxItem, insertInboxItem, listInboxItems } from './repository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listInboxItems', () => {
  it('returns rows ordered by createdAt desc', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([mockInboxRow]),
      }),
    });
    const items = await listInboxItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Test idea');
  });
});

describe('insertInboxItem', () => {
  it('inserts and returns the new row', async () => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockInboxRow]),
      }),
    });
    const item = await insertInboxItem({ title: 'Test idea', body: '', type: 'feature' });
    expect(item.id).toBe(1);
    expect(item.title).toBe('Test idea');
  });
});

describe('getInboxItem', () => {
  it('returns the item when found', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockInboxRow]),
      }),
    });
    const item = await getInboxItem(1);
    expect(item).not.toBeNull();
    expect(item?.id).toBe(1);
  });

  it('returns null when not found', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    const item = await getInboxItem(999);
    expect(item).toBeNull();
  });
});

describe('deleteInboxItem', () => {
  it('calls delete without throwing', async () => {
    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    await expect(deleteInboxItem(1)).resolves.toBeUndefined();
  });
});
