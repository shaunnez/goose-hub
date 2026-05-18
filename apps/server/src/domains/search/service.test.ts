import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListProjects, mockGetSourceForSlug } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetSourceForSlug: vi.fn(),
}));

vi.mock('#shared/projects.js', () => ({
  listProjects: mockListProjects,
}));

vi.mock('#shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { parseLimit, search } from './service.js';

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
