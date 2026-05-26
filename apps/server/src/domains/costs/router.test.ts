import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetCostSummary,
  mockGetCostsForWorkItem,
  mockGetToolStatsForWorkItem,
  mockGetProject,
  mockResolveGlobalSettings,
  mockResolveWorkItemForRoute,
} = vi.hoisted(() => ({
  mockGetCostSummary: vi.fn(),
  mockGetCostsForWorkItem: vi.fn(),
  mockGetToolStatsForWorkItem: vi.fn(),
  mockGetProject: vi.fn(),
  mockResolveGlobalSettings: vi.fn(),
  mockResolveWorkItemForRoute: vi.fn(),
}));

vi.mock('@goose-hub/core/agent-runtime/resolve-for-project.js', () => ({
  resolveGlobalSettingsForProject: mockResolveGlobalSettings,
}));

vi.mock('./service.js', () => ({
  getCostSummary: mockGetCostSummary,
  getCostsForWorkItem: mockGetCostsForWorkItem,
  getToolStatsForWorkItem: mockGetToolStatsForWorkItem,
}));

vi.mock('#shared/projects.js', () => ({
  getProject: mockGetProject,
}));

vi.mock('#shared/work-item-resolution.js', () => ({
  resolveWorkItemForRoute: mockResolveWorkItemForRoute,
}));

import { costsRouter } from './router.js';

function makeApp() {
  return new Hono().route('/', costsRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveGlobalSettings.mockReturnValue({ dailyTokens: 50_000_000 });
  mockResolveWorkItemForRoute.mockResolvedValue({
    ok: true,
    data: { canonicalWorkItemId: 'github:shaunnez/goose-hub#42' },
  });
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
    mockGetProject.mockResolvedValue({
      source: { kind: 'github', repo: 'org/repo' },
      budgets: { dailyTokens: 50_000_000 },
    });
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
    expect(mockGetCostSummary).toHaveBeenCalledWith('goose-hub-self', {
      dailyTokensLimit: 50_000_000,
    });
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
    mockResolveWorkItemForRoute.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/missing-slug/issues/42/costs');
    expect(res.status).toBe(404);
    expect(mockGetCostsForWorkItem).not.toHaveBeenCalled();
  });

  it('uses the canonical work item id from route resolution', async () => {
    mockResolveWorkItemForRoute.mockResolvedValue({
      ok: true,
      data: { canonicalWorkItemId: 'github:shaunnez/goose-hub#42' },
    });
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

  it('uses local-db canonical ids without synthesizing GitHub ids', async () => {
    mockResolveWorkItemForRoute.mockResolvedValue({
      ok: true,
      data: { canonicalWorkItemId: 'wi_local_7' },
    });
    mockGetCostsForWorkItem.mockResolvedValue({
      ok: true,
      data: { workItemId: 'wi_local_7', totalUsd: 0, hasEstimated: false, rows: [] },
    });

    const app = makeApp();
    await app.request('/my-slug/issues/7/costs');
    expect(mockGetCostsForWorkItem).toHaveBeenCalledWith('wi_local_7');
  });

  it('forwards service error status and body', async () => {
    mockGetCostsForWorkItem.mockResolvedValue({ ok: false, error: 'bad input', status: 400 });

    const app = makeApp();
    const res = await app.request('/proj/issues/9/costs');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad input');
  });
});

describe('GET /:slug/issues/:id/tool-stats', () => {
  it('returns joined run tool stats for a work item', async () => {
    const data = {
      workItemId: 'github:shaunnez/goose-hub#42',
      rows: [{ runId: 'r1', skill: 'implement', readCount: 4, bytesRead: 2048 }],
    };
    mockGetToolStatsForWorkItem.mockResolvedValue({ ok: true, data });

    const app = makeApp();
    const res = await app.request('/goose-hub-self/issues/42/tool-stats');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(data);
    expect(mockGetToolStatsForWorkItem).toHaveBeenCalledWith('github:shaunnez/goose-hub#42');
  });
});
