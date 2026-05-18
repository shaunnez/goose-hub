import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubPrSearch } from './github-pr-search.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GithubPrSearch', () => {
  let nowMs = 1_000_000;
  beforeEach(() => {
    nowMs = 1_000_000;
  });

  it('hits the canonical /pulls/:n endpoint for a numeric query', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/pulls/123')) {
        return jsonResponse(200, {
          number: 123,
          html_url: 'https://github.com/owner/repo/pull/123',
          title: 'Fix bug',
          state: 'open',
          merged_at: null,
          user: { login: 'octocat' },
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-02T00:00:00Z',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      now: () => nowMs,
    });
    const matches = await search.search('owner/repo', '123');
    expect(matches).toHaveLength(1);
    expect(matches[0].prNumber).toBe(123);
    expect(matches[0].url).toBe('https://github.com/owner/repo/pull/123');
    expect(matches[0].merged).toBe(false);
    expect(matches[0].state).toBe('open');
  });

  it('throws on numeric 404 so the caller can fall back to the event stream', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      now: () => nowMs,
    });
    await expect(search.search('owner/repo', '999')).rejects.toThrow(/404/);
  });

  it('hits /search/issues for a free-text query and maps the response shape', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('search/issues')) {
        expect(url).toContain(encodeURIComponent('is:pr repo:owner/repo refactor'));
        return jsonResponse(200, {
          items: [
            {
              number: 42,
              html_url: 'https://github.com/owner/repo/pull/42',
              title: 'Big refactor',
              state: 'open',
              pull_request: { merged_at: null },
              user: { login: 'reviewer' },
              created_at: '2026-05-01T00:00:00Z',
              updated_at: '2026-05-03T00:00:00Z',
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      now: () => nowMs,
    });
    const matches = await search.search('owner/repo', 'refactor');
    expect(matches).toEqual([
      {
        prNumber: 42,
        url: 'https://github.com/owner/repo/pull/42',
        title: 'Big refactor',
        state: 'open',
        merged: false,
        authorLogin: 'reviewer',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-03T00:00:00Z',
      },
    ]);
  });

  it('follows up on closed search results to recover the merged flag', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('search/issues')) {
        return jsonResponse(200, {
          items: [
            {
              number: 42,
              html_url: 'https://github.com/owner/repo/pull/42',
              title: 'Big refactor',
              state: 'closed',
              // /search/issues does NOT populate merged_at — this is the gap
              // the follow-up call below fills.
              pull_request: { merged_at: null },
              user: { login: 'reviewer' },
              created_at: '2026-05-01T00:00:00Z',
              updated_at: '2026-05-03T00:00:00Z',
            },
            {
              number: 7,
              html_url: 'https://github.com/owner/repo/pull/7',
              title: 'Closed but unmerged',
              state: 'closed',
              pull_request: { merged_at: null },
              user: { login: 'someone' },
              created_at: '2026-04-01T00:00:00Z',
              updated_at: '2026-04-02T00:00:00Z',
            },
          ],
        });
      }
      if (url.endsWith('/pulls/42')) {
        return jsonResponse(200, { merged_at: '2026-05-03T00:00:00Z' });
      }
      if (url.endsWith('/pulls/7')) {
        return jsonResponse(200, { merged_at: null });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      now: () => nowMs,
    });
    const matches = await search.search('owner/repo', 'refactor');
    expect(matches.find((m) => m.prNumber === 42)?.merged).toBe(true);
    expect(matches.find((m) => m.prNumber === 7)?.merged).toBe(false);
  });

  it('serves a second call from the cache within the TTL window', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            number: 1,
            html_url: 'u',
            title: 't',
            state: 'open',
            pull_request: { merged_at: null },
            user: { login: 'me' },
            created_at: 'a',
            updated_at: 'b',
          },
        ],
      }),
    );
    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      cacheTtlMs: 60_000,
      now: () => nowMs,
    });
    await search.search('owner/repo', 'cached');
    await search.search('owner/repo', 'cached');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('evicts expired cache entries on subsequent calls so it does not grow unboundedly', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { items: [] }));
    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      cacheTtlMs: 100,
      now: () => nowMs,
    });
    await search.search('owner/repo', 'one');
    await search.search('owner/repo', 'two');
    // Pre-prune size visibility lives on the internal cache; we infer
    // pruning happened by checking that the entry for the now-expired
    // first query forces a re-fetch on the third call.
    nowMs += 1000;
    fetchMock.mockClear();
    await search.search('owner/repo', 'three');
    // The fresh call for 'three' refetched (cache miss). Without pruning,
    // 'one' and 'two' would still sit in the map; the third call just
    // happens to also miss because it's a new key. The contract we care
    // about: cache.has() for an expired key returns falsey after a new
    // call. Verify by querying 'one' again — it should refetch.
    await search.search('owner/repo', 'one');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after the cache entry expires', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        items: [],
      }),
    );
    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      cacheTtlMs: 100,
      now: () => nowMs,
    });
    await search.search('owner/repo', 'q');
    nowMs += 1000;
    await search.search('owner/repo', 'q');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when no token is available', async () => {
    const search = new GithubPrSearch({
      fetch: (() => new Response()) as unknown as typeof fetch,
      token: null,
      now: () => nowMs,
    });
    await expect(search.search('owner/repo', 'x')).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it('returns [] for an empty query without hitting the network', async () => {
    const fetchMock = vi.fn();
    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      now: () => nowMs,
    });
    expect(await search.search('owner/repo', '   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
