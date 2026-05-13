import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListProjectConfigs } = vi.hoisted(() => ({
  mockListProjectConfigs: vi.fn(),
}));

vi.mock('#shared/projects.js', () => ({
  listProjectConfigs: mockListProjectConfigs,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getChangelog, parseDays } from './service.js';

const now = new Date('2026-05-13T12:00:00Z');

function mockOk(prs: unknown[]): Response {
  return new Response(JSON.stringify(prs), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFail(status = 500): Response {
  return new Response('boom', { status });
}

function pr(
  over: Partial<{
    number: number;
    title: string;
    merged_at: string | null;
    html_url: string;
    user: { login: string } | null;
  }> = {},
) {
  return {
    number: 1,
    title: 'A PR',
    merged_at: '2026-05-12T10:00:00Z',
    html_url: 'https://github.com/o/r/pull/1',
    user: { login: 'octocat' },
    ...over,
  };
}

describe('parseDays', () => {
  it('returns default 7 when missing or unparseable', () => {
    expect(parseDays(undefined)).toBe(7);
    expect(parseDays('')).toBe(7);
    expect(parseDays('abc')).toBe(7);
    expect(parseDays('3.5')).toBe(7);
  });
  it('clamps to [1, 90]', () => {
    expect(parseDays('0')).toBe(1);
    expect(parseDays('-1')).toBe(1);
    expect(parseDays('999')).toBe(90);
    expect(parseDays('90')).toBe(90);
  });
  it('passes integers in range through', () => {
    expect(parseDays('1')).toBe(1);
    expect(parseDays('14')).toBe(14);
  });
});

describe('getChangelog', () => {
  const originalToken = process.env.GITHUB_TOKEN;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-token';
  });
  afterAll(() => {
    process.env.GITHUB_TOKEN = originalToken;
  });

  it('returns 500 when GITHUB_TOKEN is missing', async () => {
    process.env.GITHUB_TOKEN = '';
    mockListProjectConfigs.mockResolvedValue([]);
    const fetchImpl = vi.fn();
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('github-token-missing');
      expect(result.status).toBe(500);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns empty array when no repos are configured', async () => {
    mockListProjectConfigs.mockResolvedValue([]);
    const fetchImpl = vi.fn();
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.entries).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('filters out PRs with null merged_at and entries older than the window', async () => {
    mockListProjectConfigs.mockResolvedValue([
      { repos: ['octo/repo'], source: { kind: 'github', repo: 'octo/repo' } },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        mockOk([
          pr({ number: 1, merged_at: '2026-05-12T10:00:00Z' }),
          pr({ number: 2, merged_at: null }),
          pr({ number: 3, merged_at: '2026-04-01T10:00:00Z' }),
        ]),
      );
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.entries).toHaveLength(1);
      expect(result.data.entries[0]).toMatchObject({
        number: 1,
        repo: 'octo/repo',
        author: 'octocat',
        mergedAt: '2026-05-12T10:00:00Z',
      });
    }
  });

  it('returns ghost user as "unknown" when GitHub user is null', async () => {
    mockListProjectConfigs.mockResolvedValue([
      { repos: ['octo/repo'], source: { kind: 'github', repo: 'octo/repo' } },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(mockOk([pr({ number: 4, user: null })]));
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.entries[0].author).toBe('unknown');
  });

  it('deduplicates repos across multiple configs and source.repo', async () => {
    mockListProjectConfigs.mockResolvedValue([
      { repos: ['octo/repo'], source: { kind: 'github', repo: 'octo/repo' } },
      { repos: ['octo/repo'], source: { kind: 'github', repo: 'octo/repo' } },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(mockOk([pr({ number: 1 })]));
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('one repo fails: returns 200 with successes from other repos', async () => {
    mockListProjectConfigs.mockResolvedValue([
      { repos: ['octo/good', 'octo/bad'], source: { kind: 'github', repo: 'octo/good' } },
    ]);
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.includes('octo/bad')) return Promise.resolve(mockFail(500));
      return Promise.resolve(mockOk([pr({ number: 7 })]));
    });
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.entries).toHaveLength(1);
      expect(result.data.entries[0].number).toBe(7);
    }
  });

  it('all repos fail: returns 500', async () => {
    mockListProjectConfigs.mockResolvedValue([
      { repos: ['octo/a', 'octo/b'], source: { kind: 'github', repo: 'octo/a' } },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(mockFail(500));
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('all-repos-failed');
      expect(result.status).toBe(500);
    }
  });

  it('sorts entries by mergedAt descending', async () => {
    mockListProjectConfigs.mockResolvedValue([
      { repos: ['octo/repo'], source: { kind: 'github', repo: 'octo/repo' } },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        mockOk([
          pr({ number: 1, merged_at: '2026-05-08T10:00:00Z' }),
          pr({ number: 2, merged_at: '2026-05-12T10:00:00Z' }),
          pr({ number: 3, merged_at: '2026-05-10T10:00:00Z' }),
        ]),
      );
    const result = await getChangelog(7, { fetchImpl, now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.entries.map((e) => e.number)).toEqual([2, 3, 1]);
    }
  });

  it('sends Bearer token in Authorization header', async () => {
    mockListProjectConfigs.mockResolvedValue([
      { repos: ['octo/repo'], source: { kind: 'github', repo: 'octo/repo' } },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(mockOk([]));
    await getChangelog(7, { fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });
});
