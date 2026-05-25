import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTotalsForProject,
  mockTotalsByStage,
  mockListCostsForWorkItem,
  mockListCostsForProjectSince,
  mockListToolStatsForWorkItem,
  mockEventReplay,
} = vi.hoisted(() => ({
  mockTotalsForProject: vi.fn(),
  mockTotalsByStage: vi.fn(),
  mockListCostsForWorkItem: vi.fn(),
  mockListCostsForProjectSince: vi.fn(),
  mockListToolStatsForWorkItem: vi.fn(),
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
  listToolStatsForWorkItem: mockListToolStatsForWorkItem,
}));

const { getCostSummary, getCostsForWorkItem, getToolStatsForWorkItem } = await import(
  './service.js'
);

describe('getCostSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventReplay.mockReturnValue([]);
    mockListToolStatsForWorkItem.mockReturnValue([]);
  });

  it('rejects empty projectId', async () => {
    const r = await getCostSummary('   ');
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('returns week, month and per-stage totals', async () => {
    mockTotalsForProject
      .mockReturnValueOnce({
        totalUsd: 1.2,
        totalRuns: 5,
        hasEstimated: true,
        inputTokens: 1000,
        cachedInputTokens: 250,
      }) // week
      .mockReturnValueOnce({
        totalUsd: 4.5,
        totalRuns: 20,
        hasEstimated: true,
        inputTokens: 2000,
        cachedInputTokens: 400,
      }); // month
    mockTotalsByStage.mockReturnValue([
      {
        stage: 'dev',
        totalUsd: 3.0,
        totalRuns: 10,
        hasEstimated: true,
        inputTokens: 1000,
        cachedInputTokens: 300,
      },
      {
        stage: 'qa',
        totalUsd: 1.0,
        totalRuns: 8,
        hasEstimated: false,
        inputTokens: 500,
        cachedInputTokens: 100,
      },
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
        cachedInputTokens: 25,
        reasoningOutputTokens: 5,
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
        cachedInputTokens: 20,
        reasoningOutputTokens: 4,
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
    expect(r.data.windows.week.cacheHitRatio).toBe(0.25);
    expect(r.data.windows.month.totalUsd).toBe(4.5);
    expect(r.data.windows.month.cachedInputTokens).toBe(400);
    expect(r.data.byStage).toHaveLength(2);
    expect(r.data.byStage[0].stage).toBe('dev');
    expect(r.data.byStage[0].cacheHitRatio).toBe(0.3);
    expect(r.data.byProvider.claude).toMatchObject({
      totalUsd: 1.5,
      totalRuns: 1,
      hasEstimated: true,
      cachedInputTokens: 25,
      cacheHitRatio: 0.25,
    });
    expect(r.data.byProvider.codex).toMatchObject({
      totalUsd: 2.0,
      totalRuns: 1,
      hasEstimated: false,
      cachedInputTokens: 20,
      cacheHitRatio: 0.25,
    });
    expect(r.data.symbolIndex).toMatchObject({
      lookupCount: 0,
      averageIdentifiersPerLookup: 0,
    });
  });

  it('includes symbol-index lookup and usage metrics', async () => {
    mockTotalsForProject
      .mockReturnValueOnce({ totalUsd: 0, totalRuns: 0, hasEstimated: false })
      .mockReturnValueOnce({ totalUsd: 0, totalRuns: 0, hasEstimated: false });
    mockTotalsByStage.mockReturnValue([]);
    mockListCostsForProjectSince.mockReturnValue([]);
    mockEventReplay.mockImplementation((filter = {}) => {
      if (filter.kind === 'project.budget-exceeded') return [];
      return [
        {
          kind: 'symbol-index.lookup',
          payload: {
            identifierCount: 4,
            hintCount: 2,
            consumerHintCounts: { 'scout-code-path': 2 },
          },
        },
        {
          kind: 'symbol-index.hints-used',
          payload: { usedHintCount: 1 },
        },
      ];
    });

    const r = await getCostSummary('goose-hub-self');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.symbolIndex.lookupCount).toBe(1);
    expect(r.data.symbolIndex.averageIdentifiersPerLookup).toBe(4);
    expect(r.data.symbolIndex.hintsUsedEventCount).toBe(1);
    expect(r.data.symbolIndex.usedHintCount).toBe(1);
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
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
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
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
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
        cachedInputTokens: 20,
        reasoningOutputTokens: 5,
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
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        costUsd: 0.005,
        costLabel: 'exact',
        personaId: null,
        createdAt: '2026-05-01T00:00:00Z',
      },
    ]);
    mockListToolStatsForWorkItem.mockReturnValue([
      {
        runId: 'r1',
        workItemId: 'github:owner/repo#1',
        stage: 'qa',
        skill: 'qa',
        modelId: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 20,
        reasoningOutputTokens: 5,
        costUsd: 0.01,
        costLabel: 'estimated',
        personaId: null,
        readCount: 3,
        grepCount: 1,
        writeCount: 0,
        editCount: 0,
        bytesRead: 4096,
        uniquePathsRead: 2,
        redundantReads: 1,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ]);
    const r = await getCostsForWorkItem('github:owner/repo#1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows).toHaveLength(2);
    expect(r.data.totalUsd).toBeCloseTo(0.015);
    expect(r.data.hasEstimated).toBe(true);
    expect(r.data.rows[0]).toMatchObject({
      readCount: 3,
      grepCount: 1,
      bytesRead: 4096,
      uniquePathsRead: 2,
      redundantReads: 1,
      cachedInputTokens: 20,
      reasoningOutputTokens: 5,
      cacheHitRatio: 0.2,
    });
    expect(r.data.rows[1]).toMatchObject({
      readCount: 0,
      bytesRead: 0,
      redundantReads: 0,
    });
  });
});

describe('getToolStatsForWorkItem', () => {
  it('returns the joined tool-intensity rows for a work item', async () => {
    mockListToolStatsForWorkItem.mockReturnValue([
      {
        runId: 'r1',
        workItemId: 'github:owner/repo#1',
        stage: 'dev',
        skill: 'implement',
        modelId: 'gpt-5.4',
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        costUsd: 0.1,
        costLabel: 'estimated',
        personaId: null,
        readCount: 7,
        grepCount: 2,
        writeCount: 1,
        editCount: 1,
        bytesRead: 8192,
        uniquePathsRead: 5,
        redundantReads: 2,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ]);

    const r = await getToolStatsForWorkItem('github:owner/repo#1');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows[0]).toMatchObject({
      runId: 'r1',
      skill: 'implement',
      provider: 'codex',
      readCount: 7,
      bytesRead: 8192,
      redundantReads: 2,
    });
  });
});
