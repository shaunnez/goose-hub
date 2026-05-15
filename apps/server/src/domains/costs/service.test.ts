import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTotalsForProject,
  mockTotalsByStage,
  mockListCostsForWorkItem,
  mockListCostsForProjectSince,
  mockEventReplay,
} = vi.hoisted(() => ({
  mockTotalsForProject: vi.fn(),
  mockTotalsByStage: vi.fn(),
  mockListCostsForWorkItem: vi.fn(),
  mockListCostsForProjectSince: vi.fn(),
  mockEventReplay: vi.fn(),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { replay: mockEventReplay },
}));

vi.mock('./repository.js', () => ({
  totalsForProjectSince: mockTotalsForProject,
  totalsByStageForProjectSince: mockTotalsByStage,
  listCostsForWorkItem: mockListCostsForWorkItem,
  listCostsForProjectSince: mockListCostsForProjectSince,
}));

const { getCostSummary, getCostsForWorkItem } = await import('./service.js');

describe('getCostSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventReplay.mockReturnValue([]);
  });

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
    mockListCostsForProjectSince.mockReturnValue([
      {
        id: 1,
        runId: 'r1',
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#1',
        stage: 'dev',
        skill: 'implement',
        modelId: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 1.5,
        costLabel: 'estimated',
        personaId: null,
        createdAt: '2026-05-01T00:00:00Z',
      },
      {
        id: 2,
        runId: 'r2',
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#2',
        stage: 'qa',
        skill: 'qa',
        modelId: 'gpt-5.4',
        inputTokens: 80,
        outputTokens: 30,
        costUsd: 2.0,
        costLabel: 'exact',
        personaId: null,
        createdAt: '2026-05-01T00:00:00Z',
      },
    ]);

    const r = await getCostSummary('goose-hub-self');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.windows.week.totalUsd).toBe(1.2);
    expect(r.data.windows.month.totalUsd).toBe(4.5);
    expect(r.data.byStage).toHaveLength(2);
    expect(r.data.byStage[0].stage).toBe('dev');
    expect(r.data.byProvider.claude).toMatchObject({
      totalUsd: 1.5,
      totalRuns: 1,
      hasEstimated: true,
    });
    expect(r.data.byProvider.codex).toMatchObject({
      totalUsd: 2.0,
      totalRuns: 1,
      hasEstimated: false,
    });
  });

  it('returns daily budget status for the current UTC day', async () => {
    mockTotalsForProject
      .mockReturnValueOnce({ totalUsd: 1.2, totalRuns: 5, hasEstimated: true })
      .mockReturnValueOnce({ totalUsd: 4.5, totalRuns: 20, hasEstimated: true });
    mockTotalsByStage.mockReturnValue([]);
    mockListCostsForProjectSince.mockReturnValue([
      {
        id: 1,
        runId: 'r1',
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#1',
        stage: 'triage',
        skill: 'triage',
        modelId: 'gpt-5.4',
        inputTokens: 600,
        outputTokens: 500,
        costUsd: 0.12,
        costLabel: 'estimated',
        personaId: null,
        createdAt: '2026-05-14T03:00:00Z',
      },
      {
        id: 2,
        runId: 'r2',
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#2',
        stage: 'dev',
        skill: 'implement',
        modelId: 'gpt-5.4',
        inputTokens: 900,
        outputTokens: 100,
        costUsd: 0.2,
        costLabel: 'estimated',
        personaId: null,
        createdAt: '2026-05-13T23:59:59Z',
      },
    ]);
    mockEventReplay.mockReturnValue([
      {
        id: 10,
        projectId: 'goose-hub-self',
        workItemId: null,
        kind: 'project.budget-exceeded',
        payload: {},
        createdAt: '2026-05-14T04:00:00Z',
      },
    ]);

    const r = await getCostSummary('goose-hub-self', {
      now: new Date('2026-05-14T12:00:00Z'),
      dailyTokensLimit: 1000,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.dailyTokensUsed).toBe(1100);
    expect(r.data.dailyTokensLimit).toBe(1000);
    expect(r.data.dailyCostUsd).toBe(0.12);
    expect(r.data.dailyBudgetExceeded).toBe(true);
    expect(r.data.resetsAtUtc).toBe('2026-05-15T00:00:00.000Z');
    expect(r.data.lastExceededAt).toBe('2026-05-14T04:00:00Z');
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
