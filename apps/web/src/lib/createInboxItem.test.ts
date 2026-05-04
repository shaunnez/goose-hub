import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for createInboxItem in @/lib/api.
// These test the REAL implementation (no module mock), only global fetch is stubbed.
// ---------------------------------------------------------------------------

describe('createInboxItem — returns created InboxItemDto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('resolves to the new item with id', async () => {
    const created = {
      id: 5,
      title: 'My idea',
      body: '',
      type: 'feature',
      createdAt: '2026-01-01T00:00:00Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ item: created }),
      }),
    );
    vi.resetModules();
    const { createInboxItem } = await import('@/lib/api');
    const result = await createInboxItem({ title: 'My idea', type: 'feature' });
    expect(result).toEqual(created);
  });

  it('result has id, title, type, createdAt fields', async () => {
    const created = {
      id: 12,
      title: 'Chore idea',
      body: 'some notes',
      type: 'chore',
      createdAt: '2026-02-01T00:00:00Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ item: created }),
      }),
    );
    vi.resetModules();
    const { createInboxItem } = await import('@/lib/api');
    const result = await createInboxItem({
      title: 'Chore idea',
      body: 'some notes',
      type: 'chore',
    });
    expect(result.id).toBe(12);
    expect(result.type).toBe('chore');
    expect(result.createdAt).toBeTruthy();
  });
});
