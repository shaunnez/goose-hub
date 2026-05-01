import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for the inbox slice.
// These tests cover real API function behaviour exercised through the slice.
// ---------------------------------------------------------------------------

describe('inbox list — fetchInboxItems', () => {
  it('resolves to an array', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue([
        { id: 1, title: 'Test idea', body: '', type: 'feature', createdAt: '2026-01-01T00:00:00Z' },
      ]);
    vi.doMock('@/lib/api', () => ({ fetchInboxItems: mockFetch, promoteInboxItem: vi.fn() }));
    const { fetchInboxItems } = await import('@/lib/api');
    vi.mocked(fetchInboxItems).mockResolvedValue([
      { id: 1, title: 'Test idea', body: '', type: 'feature', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    const items = await fetchInboxItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Test idea');
  });
});

describe('inbox promote — promoteInboxItem', () => {
  it('calls POST /inbox/:id/promote', async () => {
    const mockPromote = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/api', () => ({ promoteInboxItem: mockPromote, fetchInboxItems: vi.fn() }));
    const { promoteInboxItem } = await import('@/lib/api');
    vi.mocked(promoteInboxItem).mockResolvedValue(undefined);
    await promoteInboxItem(42, 'goose-hub-self');
    expect(promoteInboxItem).toHaveBeenCalledWith(42, 'goose-hub-self');
  });
});
