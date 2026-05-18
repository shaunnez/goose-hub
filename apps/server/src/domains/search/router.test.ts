import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearch } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
}));

vi.mock('./service.js', async () => {
  const actual = await vi.importActual<typeof import('./service.js')>('./service.js');
  return {
    ...actual,
    search: mockSearch,
  };
});

import { searchRouter } from './router.js';

function makeApp() {
  return new Hono().route('/search', searchRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /search', () => {
  it('returns the result payload on success', async () => {
    mockSearch.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            projectSlug: 'goose-hub-self',
            externalId: '42',
            title: 'cache layer',
            state: 'factory:triaging',
            type: 'feature',
            priority: 'medium',
            milestoneTitle: 'M19',
            repoRef: 'shaunnez/goose-hub',
            confidence: 100,
          },
        ],
        total: 1,
        hasMore: false,
      },
    });
    const res = await makeApp().request('/search?q=cache');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number; hasMore: boolean };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledWith({
      q: 'cache',
      limit: 50,
      projectSlug: undefined,
      type: undefined,
      milestone: 'active',
      includeClosed: false,
    });
  });

  it('passes through the limit query param when present', async () => {
    mockSearch.mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, hasMore: false },
    });
    await makeApp().request('/search?q=foo&limit=5');
    expect(mockSearch).toHaveBeenCalledWith({
      q: 'foo',
      limit: 5,
      projectSlug: undefined,
      type: undefined,
      milestone: 'active',
      includeClosed: false,
    });
  });

  it('forwards projectSlug, type, milestone, and includeClosed filters', async () => {
    mockSearch.mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, hasMore: false },
    });
    await makeApp().request(
      '/search?q=cache&projectSlug=goose-hub-self&type=bug&milestone=all&includeClosed=true',
    );
    expect(mockSearch).toHaveBeenCalledWith({
      q: 'cache',
      limit: 50,
      projectSlug: 'goose-hub-self',
      type: 'bug',
      milestone: 'all',
      includeClosed: true,
    });
  });

  it('defaults q to empty string when omitted', async () => {
    mockSearch.mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, hasMore: false },
    });
    await makeApp().request('/search');
    expect(mockSearch).toHaveBeenCalledWith({
      q: '',
      limit: 50,
      projectSlug: undefined,
      type: undefined,
      milestone: 'active',
      includeClosed: false,
    });
  });

  it('returns 500 when the service surfaces an error', async () => {
    mockSearch.mockResolvedValue({ ok: false, error: 'boom', status: 500 });
    const res = await makeApp().request('/search?q=x');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('boom');
  });
});
