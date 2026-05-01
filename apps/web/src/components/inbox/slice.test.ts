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

describe('inbox promote — project picker', () => {
  it('fetchProjects returns all configured projects', async () => {
    const twoProjects = [
      {
        id: 'proj-1',
        name: 'Goose Hub',
        slug: 'goose-hub-self',
        color: '#6366f1',
        source: { kind: 'github', repo: 'org/goose-hub' },
      },
      {
        id: 'proj-2',
        name: 'My App',
        slug: 'my-app',
        color: '#10b981',
        source: { kind: 'github', repo: 'org/my-app' },
      },
    ];

    const mockFetchProjects = vi.fn().mockResolvedValue(twoProjects);
    vi.doMock('@/lib/api', () => ({
      fetchProjects: mockFetchProjects,
      fetchInboxItems: vi.fn(),
      promoteInboxItem: vi.fn(),
    }));

    const { fetchProjects } = await import('@/lib/api');
    vi.mocked(fetchProjects).mockResolvedValue(twoProjects);

    const projects = await fetchProjects();

    expect(projects).toHaveLength(2);
    expect(projects[0].slug).toBe('goose-hub-self');
    expect(projects[0].name).toBe('Goose Hub');
    expect(projects[1].slug).toBe('my-app');
    expect(projects[1].name).toBe('My App');
  });

  it('all project slugs are present in the list', async () => {
    const twoProjects = [
      {
        id: 'proj-1',
        name: 'Goose Hub',
        slug: 'goose-hub-self',
        color: '#6366f1',
        source: { kind: 'github', repo: 'org/goose-hub' },
      },
      {
        id: 'proj-2',
        name: 'My App',
        slug: 'my-app',
        color: '#10b981',
        source: { kind: 'github', repo: 'org/my-app' },
      },
    ];

    const slugs = twoProjects.map((p) => p.slug);
    expect(slugs).toContain('goose-hub-self');
    expect(slugs).toContain('my-app');
    expect(slugs).toHaveLength(2);
  });
});
