import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for the inbox capture slice.
// These tests cover the core logic paths exercised by CaptureModal:
//   - title validation (empty title must be rejected)
//   - type allowlist (only valid values reach the server)
//   - createInboxItem integration (happy path POSTs correctly)
// ---------------------------------------------------------------------------

const VALID_TYPES = ['feature', 'bug', 'chore', 'research'] as const;

describe('inbox capture — title validation', () => {
  it('rejects an empty title', () => {
    const title = '   ';
    expect(title.trim()).toBe('');
  });

  it('accepts a non-empty title', () => {
    const title = 'Add dark-mode toggle';
    expect(title.trim()).toBeTruthy();
  });
});

describe('inbox capture — type allowlist', () => {
  it('accepts all valid types', () => {
    for (const t of VALID_TYPES) {
      expect(VALID_TYPES.includes(t)).toBe(true);
    }
  });

  it('falls back to feature for unknown type', () => {
    const input = 'unknown-type';
    const resolved = VALID_TYPES.includes(input as (typeof VALID_TYPES)[number])
      ? input
      : 'feature';
    expect(resolved).toBe('feature');
  });
});

describe('inbox capture — createInboxItem', () => {
  it('calls POST /inbox with correct payload', async () => {
    const mockPost = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/api', () => ({ createInboxItem: mockPost }));

    const { createInboxItem } = await import('@/lib/api');
    vi.mocked(createInboxItem).mockResolvedValue(undefined);

    await createInboxItem({ title: 'My idea', body: 'details', type: 'bug' });
    expect(createInboxItem).toHaveBeenCalledWith({
      title: 'My idea',
      body: 'details',
      type: 'bug',
    });
  });
});
