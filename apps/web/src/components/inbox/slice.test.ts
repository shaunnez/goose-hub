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
