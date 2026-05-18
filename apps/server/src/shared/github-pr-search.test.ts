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

  it('returns an empty array when a numeric PR is 404 on the GitHub side', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
    const search = new GithubPrSearch({
      fetch: fetchMock as unknown as typeof fetch,
      token: 'ghp_test',
      now: () => nowMs,
    });
    expect(await search.search('owner/repo', '999')).toEqual([]);
  });

  it('hits /search/issues for a free-text query and maps the response shape', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('search/issues');
      expect(url).toContain(encodeURIComponent('is:pr repo:owner/repo refactor'));
      return jsonResponse(200, {
        items: [
          {
            number: 42,
            html_url: 'https://github.com/owner/repo/pull/42',
            title: 'Big refactor',
            state: 'closed',
            pull_request: { merged_at: '2026-05-03T00:00:00Z' },
            user: { login: 'reviewer' },
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-03T00:00:00Z',
          },
        ],
      });
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
        state: 'closed',
        merged: true,
        authorLogin: 'reviewer',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-03T00:00:00Z',
      },
    ]);
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
