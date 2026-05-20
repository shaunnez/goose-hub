import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetChangelog } = vi.hoisted(() => ({
  mockGetChangelog: vi.fn(),
}));

vi.mock('./service.js', async () => {
  const actual = await vi.importActual<typeof import('./service.js')>('./service.js');
  return {
    ...actual,
    getChangelog: mockGetChangelog,
  };
});

import { changelogRouter } from './router.js';

function makeApp(mountPath: '/api/changelog' | '/changelog' = '/api/changelog') {
  return new Hono().route(mountPath, changelogRouter);
}

describe('GET /api/changelog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns entries array on success', async () => {
    mockGetChangelog.mockResolvedValue({
      ok: true,
      data: {
        entries: [
          {
            number: 7,
            title: 'A',
            mergedAt: '2026-05-12T10:00:00Z',
            url: 'u',
            repo: 'o/r',
            author: 'octocat',
          },
        ],
      },
    });
    const app = makeApp();
    const res = await app.request('/api/changelog?days=7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it('defaults days to 7 when missing', async () => {
    mockGetChangelog.mockResolvedValue({ ok: true, data: { entries: [] } });
    const app = makeApp();
    await app.request('/api/changelog');
    expect(mockGetChangelog).toHaveBeenCalledWith(7);
  });

  it('forwards parsed days param when valid', async () => {
    mockGetChangelog.mockResolvedValue({ ok: true, data: { entries: [] } });
    const app = makeApp();
    await app.request('/api/changelog?days=14');
    expect(mockGetChangelog).toHaveBeenCalledWith(14);
  });

  it('clamps days outside range', async () => {
    mockGetChangelog.mockResolvedValue({ ok: true, data: { entries: [] } });
    const app = makeApp();
    await app.request('/api/changelog?days=999');
    expect(mockGetChangelog).toHaveBeenCalledWith(90);
  });

  it('returns 500 with error body when service fails', async () => {
    mockGetChangelog.mockResolvedValue({
      ok: false,
      error: 'github-token-missing',
      status: 500,
    });
    const app = makeApp();
    const res = await app.request('/api/changelog');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('github-token-missing');
  });
});

describe('GET /changelog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns entries array on success through the rewritten parent mount', async () => {
    mockGetChangelog.mockResolvedValue({
      ok: true,
      data: {
        entries: [
          {
            number: 7,
            title: 'A',
            mergedAt: '2026-05-12T10:00:00Z',
            url: 'u',
            repo: 'o/r',
            author: 'octocat',
          },
        ],
      },
    });
    const res = await makeApp('/changelog').request('/changelog?days=7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it('forwards parsed days param when valid through the rewritten parent mount', async () => {
    mockGetChangelog.mockResolvedValue({ ok: true, data: { entries: [] } });
    await makeApp('/changelog').request('/changelog?days=14');
    expect(mockGetChangelog).toHaveBeenCalledWith(14);
  });
});
