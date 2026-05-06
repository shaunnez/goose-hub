import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCostSummary, mockGetCostsForWorkItem, mockGetProject } = vi.hoisted(() => ({
  mockGetCostSummary: vi.fn(),
  mockGetCostsForWorkItem: vi.fn(),
  mockGetProject: vi.fn(),
}));

vi.mock('./service.js', () => ({
  getCostSummary: mockGetCostSummary,
  getCostsForWorkItem: mockGetCostsForWorkItem,
}));

vi.mock('#shared/projects.js', () => ({
  getProject: mockGetProject,
}));

import { costsRouter } from './router.js';

function makeApp() {
  return new Hono().route('/', costsRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /:slug/costs/summary', () => {
  it('returns 404 when project is not configured', async () => {
    mockGetProject.mockResolvedValue(null);

    const app = makeApp();
    const res = await app.request('/missing-slug/costs/summary');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('project not found');
    expect(mockGetCostSummary).not.toHaveBeenCalled();
  });

  it('returns 200 with summary data on success', async () => {
    mockGetProject.mockResolvedValue({ source: { kind: 'github', repo: 'org/repo' } });
    const summary = {
      projectId: 'goose-hub-self',
      windows: {
        week: { totalUsd: 1.2, totalRuns: 3, hasEstimated: false },
        month: { totalUsd: 4.5, totalRuns: 10, hasEstimated: true },
      },
      byStage: [],
    };
    mockGetCostSummary.mockResolvedValue({ ok: true, data: summary });

    const app = makeApp();
    const res = await app.request('/goose-hub-self/costs/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(summary);
    expect(mockGetCostSummary).toHaveBeenCalledWith('goose-hub-self');
  });

  it('forwards service error status and body', async () => {
    mockGetProject.mockResolvedValue({ source: { kind: 'github', repo: 'org/repo' } });
    mockGetCostSummary.mockResolvedValue({ ok: false, error: 'oops', status: 400 });

    const app = makeApp();
    const res = await app.request('/goose-hub-self/costs/summary');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('oops');
  });
});

describe('GET /:slug/issues/:id/costs', () => {
  it('returns 404 when project is not configured', async () => {
    mockGetProject.mockResolvedValue(null);

    const app = makeApp();
    const res = await app.request('/missing-slug/issues/42/costs');
    expect(res.status).toBe(404);
    expect(mockGetCostsForWorkItem).not.toHaveBeenCalled();
  });

  it('builds workItemId from github repo when source.kind is github', async () => {
    mockGetProject.mockResolvedValue({ source: { kind: 'github', repo: 'shaunnez/goose-hub' } });
    mockGetCostsForWorkItem.mockResolvedValue({
      ok: true,
      data: {
        workItemId: 'github:shaunnez/goose-hub#42',
        totalUsd: 0,
        hasEstimated: false,
        rows: [],
      },
    });

    const app = makeApp();
    const res = await app.request('/goose-hub-self/issues/42/costs');
    expect(res.status).toBe(200);
    expect(mockGetCostsForWorkItem).toHaveBeenCalledWith('github:shaunnez/goose-hub#42');
  });

  it('falls back to slug as repoRef when source.kind is not github', async () => {
    mockGetProject.mockResolvedValue({ source: { kind: 'jira' } });
    mockGetCostsForWorkItem.mockResolvedValue({
      ok: true,
      data: { workItemId: 'github:my-slug#7', totalUsd: 0, hasEstimated: false, rows: [] },
    });

    const app = makeApp();
    await app.request('/my-slug/issues/7/costs');
    expect(mockGetCostsForWorkItem).toHaveBeenCalledWith('github:my-slug#7');
  });

  it('forwards service error status and body', async () => {
    mockGetProject.mockResolvedValue({ source: { kind: 'github', repo: 'org/repo' } });
    mockGetCostsForWorkItem.mockResolvedValue({ ok: false, error: 'bad input', status: 400 });

    const app = makeApp();
    const res = await app.request('/proj/issues/9/costs');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad input');
  });
});
