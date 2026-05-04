import { describe, expect, it, vi } from 'vitest';

const { mockTotalsForProject, mockTotalsByStage, mockListCostsForWorkItem } = vi.hoisted(() => ({
  mockTotalsForProject: vi.fn(),
  mockTotalsByStage: vi.fn(),
  mockListCostsForWorkItem: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  totalsForProjectSince: mockTotalsForProject,
  totalsByStageForProjectSince: mockTotalsByStage,
  listCostsForWorkItem: mockListCostsForWorkItem,
}));

const { getCostSummary, getCostsForWorkItem } = await import('./service.js');

describe('getCostSummary', () => {
  it('rejects empty projectId', async () => {
    const r = await getCostSummary('   ');
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('returns week, month and per-stage totals', async () => {
    mockTotalsForProject
      .mockReturnValueOnce({ totalUsd: 1.2, totalRuns: 5, hasEstimated: true }) // week
      .mockReturnValueOnce({ totalUsd: 4.5, totalRuns: 20, hasEstimated: true }); // month
    mockTotalsByStage.mockReturnValue([
      { stage: 'dev', totalUsd: 3.0, totalRuns: 10, hasEstimated: true },
      { stage: 'qa', totalUsd: 1.0, totalRuns: 8, hasEstimated: false },
    ]);

    const r = await getCostSummary('goose-hub-self');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.windows.week.totalUsd).toBe(1.2);
    expect(r.data.windows.month.totalUsd).toBe(4.5);
    expect(r.data.byStage).toHaveLength(2);
    expect(r.data.byStage[0].stage).toBe('dev');
  });
});

describe('getCostsForWorkItem', () => {
  it('rejects empty workItemId', async () => {
    const r = await getCostsForWorkItem('  ');
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('returns rows + total + estimated flag', async () => {
    mockListCostsForWorkItem.mockReturnValue([
      {
        id: 1,
        runId: 'r1',
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#1',
        stage: 'qa',
        skill: 'qa',
        modelId: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
        costLabel: 'estimated',
        personaId: null,
        createdAt: '2026-05-01T00:00:00Z',
      },
      {
        id: 2,
        runId: 'r2',
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#1',
        stage: 'review',
        skill: 'review',
        modelId: 'claude-sonnet-4-6',
        inputTokens: 80,
        outputTokens: 30,
        costUsd: 0.005,
        costLabel: 'exact',
        personaId: null,
        createdAt: '2026-05-01T00:00:00Z',
      },
    ]);
    const r = await getCostsForWorkItem('github:owner/repo#1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows).toHaveLength(2);
    expect(r.data.totalUsd).toBeCloseTo(0.015);
    expect(r.data.hasEstimated).toBe(true);
  });
});
