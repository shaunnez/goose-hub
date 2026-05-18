import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListProjects, mockGetSourceForSlug, mockResolveActiveMilestone } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetSourceForSlug: vi.fn(),
  mockResolveActiveMilestone: vi.fn(),
}));

vi.mock('#shared/projects.js', () => ({
  listProjects: mockListProjects,
}));

vi.mock('#shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
}));

vi.mock('#shared/resolve-milestone.js', () => ({
  resolveActiveMilestone: mockResolveActiveMilestone,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { parseLimit, parseMilestone, parseType, search } from './service.js';

const now = new Date('2026-05-18T00:00:00Z');

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#1',
    externalId: '1',
    repoRef: 'shaunnez/goose-hub',
    title: 'Default title',
    body: 'Default body',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'parallel',
    dependsOn: [],
    blocks: [],
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

function mockSource(items: WorkItem[]) {
  return {
    projectId: 'p',
    repoRef: 'r',
    listOpenWork: vi.fn().mockResolvedValue(items),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default to "no active milestone configured" so existing tests that
  // pass milestone:'all' (or rely on the default) get the full item set.
  mockResolveActiveMilestone.mockResolvedValue({
    milestoneNumber: null,
    source: 'project_state',
  });
});

describe('parseLimit', () => {
  it('returns default 50 when missing or unparseable', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('')).toBe(50);
    expect(parseLimit('abc')).toBe(50);
  });

  it('clamps to [1, 100]', () => {
    expect(parseLimit('0')).toBe(1);
    expect(parseLimit('1000')).toBe(100);
    expect(parseLimit('25')).toBe(25);
  });
});

describe('search', () => {
  it('short-circuits empty queries with no items and total 0', async () => {
    mockListProjects.mockResolvedValue([]);
    const result = await search({ q: '  ' }, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toEqual([]);
      expect(result.data.total).toBe(0);
      expect(result.data.hasMore).toBe(false);
    }
    expect(mockGetSourceForSlug).not.toHaveBeenCalled();
  });

  it('returns ranked hits with confidence normalised to top result = 100', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p1' }, { slug: 'p2' }]);
    mockGetSourceForSlug.mockImplementation((slug: string) => {
      if (slug === 'p1') {
        return Promise.resolve(
          mockSource([
            item({ id: 'p1#1', externalId: '1', title: 'cache layer for tier-2 results' }),
          ]),
        );
      }
      return Promise.resolve(
        mockSource([
          item({
            id: 'p2#2',
            externalId: '2',
            title: 'unrelated header',
            body: 'cache mention buried in the body',
          }),
        ]),
      );
    });

    const result = await search({ q: 'cache' }, { now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.map((h) => h.externalId)).toEqual(['1', '2']);
    expect(result.data.items[0].confidence).toBe(100);
    expect(result.data.items[1].confidence).toBeLessThan(100);
    expect(result.data.items[1].confidence).toBeGreaterThan(0);
    expect(result.data.total).toBe(2);
  });

  it('filters out items with zero score', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p1' }]);
    mockGetSourceForSlug.mockResolvedValue(
      mockSource([
        item({ externalId: '1', title: 'cache layer' }),
        item({ externalId: '2', title: 'unrelated foo bar' }),
      ]),
    );

    const result = await search({ q: 'cache' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items.map((h) => h.externalId)).toEqual(['1']);
    expect(result.data.total).toBe(1);
  });

  it('honours limit and reports hasMore correctly', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p1' }]);
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ externalId: String(i + 1), title: `cache slot ${i + 1}` }),
    );
    mockGetSourceForSlug.mockResolvedValue(mockSource(items));

    const result = await search({ q: 'cache', limit: 2 }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items).toHaveLength(2);
    expect(result.data.total).toBe(5);
    expect(result.data.hasMore).toBe(true);
  });

  it('survives a project whose source listOpenWork rejects', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'broken' }, { slug: 'ok' }]);
    mockGetSourceForSlug.mockImplementation((slug: string) => {
      if (slug === 'broken') {
        return Promise.resolve({
          projectId: 'b',
          repoRef: 'r',
          listOpenWork: vi.fn().mockRejectedValue(new Error('GitHub 502')),
        });
      }
      return Promise.resolve(
        mockSource([item({ externalId: '7', title: 'cache hit', id: 'ok#7' })]),
      );
    });

    const result = await search({ q: 'cache' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items.map((h) => h.externalId)).toEqual(['7']);
  });

  it('treats "#42" as a direct lookup and returns confidence 100', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p1' }]);
    mockGetSourceForSlug.mockResolvedValue(
      mockSource([
        item({ externalId: '7', title: 'unrelated' }),
        item({ externalId: '42', title: 'this is the one' }),
      ]),
    );
    const result = await search({ q: '#42' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items[0].externalId).toBe('42');
    expect(result.data.items[0].confidence).toBe(100);
  });
});

describe('search — filters', () => {
  it('projectSlug narrows iteration to a single project', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'a' }, { slug: 'b' }]);
    const sourceA = mockSource([item({ externalId: '1', title: 'cache from a' })]);
    const sourceB = mockSource([item({ externalId: '2', title: 'cache from b' })]);
    mockGetSourceForSlug.mockImplementation((slug: string) =>
      Promise.resolve(slug === 'a' ? sourceA : sourceB),
    );

    const result = await search({ q: 'cache', projectSlug: 'a' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items.map((h) => h.externalId)).toEqual(['1']);
    expect(sourceB.listOpenWork).not.toHaveBeenCalled();
  });

  it('type filter excludes work items of other types', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    mockGetSourceForSlug.mockResolvedValue(
      mockSource([
        item({ externalId: '1', title: 'cache feature', type: 'feature' }),
        item({ externalId: '2', title: 'cache bug', type: 'bug' }),
      ]),
    );
    const result = await search({ q: 'cache', type: 'bug' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items.map((h) => h.externalId)).toEqual(['2']);
  });

  it('milestone:active passes the resolved milestone number to listOpenWork', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    const source = mockSource([item({ externalId: '1', title: 'cache' })]);
    mockGetSourceForSlug.mockResolvedValue(source);
    mockResolveActiveMilestone.mockResolvedValue({
      milestoneNumber: 19,
      source: 'project_state',
    });
    await search({ q: 'cache', milestone: 'active' }, { now });
    expect(source.listOpenWork).toHaveBeenCalledWith(19);
  });

  it('milestone:all does not consult the active-milestone resolver', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    const source = mockSource([item({ externalId: '1', title: 'cache' })]);
    mockGetSourceForSlug.mockResolvedValue(source);
    await search({ q: 'cache', milestone: 'all' }, { now });
    expect(mockResolveActiveMilestone).not.toHaveBeenCalled();
    expect(source.listOpenWork).toHaveBeenCalledWith(undefined);
  });
});

describe('parseType / parseMilestone', () => {
  it('parseType returns undefined for missing/invalid/empty', () => {
    expect(parseType(undefined)).toBeUndefined();
    expect(parseType('')).toBeUndefined();
    expect(parseType('garbage')).toBeUndefined();
  });

  it('parseType accepts the four valid types', () => {
    for (const t of ['feature', 'bug', 'chore', 'research']) {
      expect(parseType(t)).toBe(t);
    }
  });

  it('parseMilestone defaults to "active"', () => {
    expect(parseMilestone(undefined)).toBe('active');
    expect(parseMilestone('')).toBe('active');
    expect(parseMilestone('garbage')).toBe('active');
  });

  it('parseMilestone accepts "active" and "all"', () => {
    expect(parseMilestone('active')).toBe('active');
    expect(parseMilestone('all')).toBe('all');
  });
});
