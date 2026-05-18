import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListProjects, mockGetSourceForSlug, mockResolveActiveMilestone, mockEventReplay } =
  vi.hoisted(() => ({
    mockListProjects: vi.fn(),
    mockGetSourceForSlug: vi.fn(),
    mockResolveActiveMilestone: vi.fn(),
    mockEventReplay: vi.fn(),
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

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { replay: mockEventReplay },
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { parseIncludeClosed, parseLimit, parseMilestone, parseType, search } from './service.js';

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

function mockSource(items: WorkItem[], closed: WorkItem[] = []) {
  return {
    projectId: 'p',
    repoRef: 'r',
    listOpenWork: vi.fn().mockResolvedValue(items),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue(closed),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Default to "no active milestone configured" so existing tests that
  // pass milestone:'all' (or rely on the default) get the full item set.
  mockResolveActiveMilestone.mockResolvedValue({
    milestoneNumber: null,
    source: 'project_state',
  });
  // Most tests don't care about events; default to no rows.
  mockEventReplay.mockReturnValue([]);
  // Cached project fan-out persists across tests in the same module —
  // reset between cases so loaders fire as the tests expect.
  const { _resetSearchCache } = await import('./cache.js');
  _resetSearchCache();
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

  it('includeClosed:true with an active milestone also pulls closed items', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    const source = mockSource(
      [item({ externalId: '1', title: 'cache open' })],
      [item({ externalId: '99', title: 'cache closed', state: 'factory:done' })],
    );
    mockGetSourceForSlug.mockResolvedValue(source);
    mockResolveActiveMilestone.mockResolvedValue({
      milestoneNumber: 19,
      source: 'project_state',
    });
    const result = await search({ q: 'cache', milestone: 'active', includeClosed: true }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(source.listClosedWorkByMilestone).toHaveBeenCalledWith(19);
    expect(result.data.items.map((h) => h.externalId).sort()).toEqual(['1', '99']);
  });

  it('includeClosed:true without an active milestone skips closed iteration', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    const source = mockSource([item({ externalId: '1', title: 'cache' })]);
    mockGetSourceForSlug.mockResolvedValue(source);
    // resolveActiveMilestone returns null (the beforeEach default), so
    // milestoneNumber is undefined and the closed branch is skipped.
    const result = await search({ q: 'cache', milestone: 'active', includeClosed: true }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(source.listClosedWorkByMilestone).not.toHaveBeenCalled();
    expect(result.data.items.map((h) => h.externalId)).toEqual(['1']);
  });

  it('includeClosed:false is the default — closed items are not fetched', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    const source = mockSource(
      [item({ externalId: '1', title: 'cache' })],
      [item({ externalId: '99', title: 'cache closed' })],
    );
    mockGetSourceForSlug.mockResolvedValue(source);
    mockResolveActiveMilestone.mockResolvedValue({
      milestoneNumber: 19,
      source: 'project_state',
    });
    await search({ q: 'cache' }, { now });
    expect(source.listClosedWorkByMilestone).not.toHaveBeenCalled();
  });
});

describe('search — events', () => {
  it('returns matching decision-summary events alongside work items', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    mockGetSourceForSlug.mockResolvedValue(mockSource([]));
    mockEventReplay.mockImplementation(({ projectId, kind }) => {
      if (projectId !== 'p' || kind !== 'agent.decision-summary') return [];
      return [
        {
          id: 9001,
          projectId: 'p',
          workItemId: 'github:o/r#42',
          kind: 'agent.decision-summary',
          payload: { summary: 'Selected payments-api as primary repo', kind: 'PLAN' },
          createdAt: '2026-05-17T10:00:00Z',
        },
        {
          id: 9002,
          projectId: 'p',
          workItemId: 'github:o/r#99',
          kind: 'agent.decision-summary',
          payload: { summary: 'Pivoted to cache tier-2 lookups', kind: 'QUERY_PIVOT' },
          createdAt: '2026-05-16T10:00:00Z',
        },
        {
          id: 9003,
          projectId: 'p',
          workItemId: null,
          kind: 'agent.decision-summary',
          payload: { summary: 'Unrelated triage decision', kind: 'PLAN' },
          createdAt: '2026-05-16T10:00:00Z',
        },
      ];
    });
    const result = await search({ q: 'cache' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.events.map((e) => e.eventId)).toEqual([9002]);
    expect(result.data.events[0].workItemExternalId).toBe('99');
    expect(result.data.events[0].decisionKind).toBe('QUERY_PIVOT');
    expect(result.data.events[0].confidence).toBe(100);
    expect(result.data.totalEvents).toBe(1);
  });

  it('event hits are independent of work-item confidence normalisation', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    mockGetSourceForSlug.mockResolvedValue(
      mockSource([item({ externalId: '1', title: 'cache layer for tier-2 results' })]),
    );
    mockEventReplay.mockReturnValue([
      {
        id: 9001,
        projectId: 'p',
        workItemId: null,
        kind: 'agent.decision-summary',
        payload: { summary: 'cache hit', kind: 'PLAN' },
        createdAt: '2026-05-17T10:00:00Z',
      },
    ]);
    const result = await search({ q: 'cache' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items[0].confidence).toBe(100);
    expect(result.data.events[0].confidence).toBe(100);
  });

  it('skips events whose payload has no summary string', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'p' }]);
    mockGetSourceForSlug.mockResolvedValue(mockSource([]));
    mockEventReplay.mockReturnValue([
      {
        id: 9001,
        projectId: 'p',
        workItemId: null,
        kind: 'agent.decision-summary',
        payload: {},
        createdAt: '2026-05-17T10:00:00Z',
      },
      {
        id: 9002,
        projectId: 'p',
        workItemId: null,
        kind: 'agent.decision-summary',
        payload: { summary: '   ' },
        createdAt: '2026-05-17T10:00:00Z',
      },
    ]);
    const result = await search({ q: 'cache' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.events).toEqual([]);
  });

  it('survives a project whose event replay throws', async () => {
    mockListProjects.mockResolvedValue([{ slug: 'broken' }, { slug: 'ok' }]);
    mockGetSourceForSlug.mockImplementation(() =>
      Promise.resolve(mockSource([item({ externalId: '7', title: 'cache hit' })])),
    );
    mockEventReplay.mockImplementation(({ projectId }) => {
      if (projectId === 'broken') throw new Error('boom');
      return [
        {
          id: 9009,
          projectId: 'ok',
          workItemId: 'github:o/r#7',
          kind: 'agent.decision-summary',
          payload: { summary: 'cache decision' },
          createdAt: '2026-05-17T10:00:00Z',
        },
      ];
    });
    const result = await search({ q: 'cache' }, { now });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.events.map((e) => e.eventId)).toEqual([9009]);
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

  it('parseIncludeClosed treats only "true" / "1" as true', () => {
    expect(parseIncludeClosed('true')).toBe(true);
    expect(parseIncludeClosed('1')).toBe(true);
    expect(parseIncludeClosed('false')).toBe(false);
    expect(parseIncludeClosed('yes')).toBe(false);
    expect(parseIncludeClosed(undefined)).toBe(false);
    expect(parseIncludeClosed('')).toBe(false);
  });
});
