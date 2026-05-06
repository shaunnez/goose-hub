import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock ──────────────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    values: vi.fn(),
    set: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    run: vi.fn(),
    all: vi.fn(),
  };

  // Default fluent chain: each method returns mockDb so chains compose
  for (const method of [
    'select',
    'insert',
    'update',
    'from',
    'where',
    'orderBy',
    'limit',
    'values',
    'set',
    'onConflictDoUpdate',
  ]) {
    (mockDb as Record<string, unknown>)[method] = vi.fn().mockReturnValue(mockDb);
  }
  mockDb.run = vi.fn();
  mockDb.all = vi.fn().mockReturnValue([]);

  return { mockDb };
});

vi.mock('../db/db.js', () => ({ db: mockDb }));
vi.mock('../db/schema.js', () => ({
  archivedLifecycles: {
    id: 'id',
    projectId: 'project_id',
    workItemId: 'work_item_id',
    closedAt: 'closed_at',
    decisionSummaries: 'decision_summaries',
    learningEntries: 'learning_entries',
    qualityScores: 'quality_scores',
    costsUsd: 'costs_usd',
    runIds: 'run_ids',
  },
  decisionPatterns: {
    id: 'id',
    projectId: 'project_id',
    kind: 'kind',
    role: 'role',
    actionSummary: 'action_summary',
    reasonSummary: 'reason_summary',
    occurrenceCount: 'occurrence_count',
    consistencyScore: 'consistency_score',
    lastSeenAt: 'last_seen_at',
    exampleWorkItemIds: 'example_work_item_ids',
  },
  agentRunCosts: { workItemId: 'work_item_id', costUsd: 'cost_usd' },
}));

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    replay: vi.fn().mockReturnValue([]),
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function resetMockDb() {
  vi.clearAllMocks();
  for (const method of [
    'select',
    'insert',
    'update',
    'from',
    'where',
    'orderBy',
    'limit',
    'values',
    'set',
    'onConflictDoUpdate',
  ]) {
    (mockDb as Record<string, unknown>)[method] = vi.fn().mockReturnValue(mockDb);
  }
  mockDb.run = vi.fn();
  mockDb.all = vi.fn().mockReturnValue([]);
}

function makeLifecycleRow(
  overrides: Partial<{
    id: number;
    projectId: string;
    workItemId: string;
    closedAt: string;
    decisionSummaries: string;
    learningEntries: string;
    qualityScores: string;
    costsUsd: number;
    runIds: string;
  }> = {},
) {
  return {
    id: 1,
    projectId: 'proj-a',
    workItemId: 'github:owner/repo#1',
    closedAt: '2026-05-01T00:00:00.000Z',
    decisionSummaries: '[]',
    learningEntries: '[]',
    qualityScores: '[]',
    costsUsd: 0,
    runIds: '[]',
    ...overrides,
  };
}

// ─── archive tests ────────────────────────────────────────────────────────────

describe('archiveLifecycle', () => {
  beforeEach(resetMockDb);

  it('writes a row to archived_lifecycles for the given workItem', async () => {
    const { eventStore } = await import('../event-stream/store.js');
    vi.mocked(eventStore.replay).mockReturnValue([]);

    // Cost query returns 0
    mockDb.all.mockReturnValue([{ total: null }]);

    const { archiveLifecycle } = await import('./archive.js');
    archiveLifecycle({ projectId: 'proj-a', workItemId: 'item-1' });

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.values).toHaveBeenCalledTimes(1);
    const inserted = mockDb.values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.projectId).toBe('proj-a');
    expect(inserted.workItemId).toBe('item-1');
    expect(inserted.costsUsd).toBe(0);
    expect(mockDb.run).toHaveBeenCalledTimes(1);
  });

  it('extracts role from personaId for decision summaries', async () => {
    const { eventStore } = await import('../event-stream/store.js');
    vi.mocked(eventStore.replay).mockReturnValue([
      {
        id: 1,
        projectId: 'proj-a',
        workItemId: 'item-1',
        kind: 'agent.decision-summary',
        payload: { kind: 'PLAN', summary: 'Planned the task', evidence: 'looked at code' },
        runId: 'run-1',
        personaId: 'proj-a/developer/0',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    ]);
    mockDb.all.mockReturnValue([{ total: null }]);

    const { archiveLifecycle } = await import('./archive.js');
    archiveLifecycle({ projectId: 'proj-a', workItemId: 'item-1' });

    const inserted = mockDb.values.mock.calls[0][0] as Record<string, unknown>;
    const summaries = JSON.parse(inserted.decisionSummaries as string) as Array<{
      kind: string;
      role: string;
      personaId: string;
    }>;
    expect(summaries).toHaveLength(1);
    expect(summaries[0].kind).toBe('PLAN');
    expect(summaries[0].role).toBe('developer');
    expect(summaries[0].personaId).toBe('proj-a/developer/0');
  });

  it('captures learningEntries and qualityScores from retrospective.completed payload', async () => {
    const { eventStore } = await import('../event-stream/store.js');
    vi.mocked(eventStore.replay).mockReturnValue([
      {
        id: 2,
        projectId: 'proj-a',
        workItemId: 'item-1',
        kind: 'retrospective.completed',
        payload: {
          output: {
            learningEntries: [
              {
                observation: 'obs',
                rationale: 'rat',
                improvementKind: 'persona',
                confidence: 'high',
              },
            ],
            personaQualityScores: [
              {
                personaId: 'proj-a/developer/0',
                score: 0.9,
                trend: 'stable',
                sampleCount: 1,
                rationale: 'ok',
              },
            ],
          },
        },
        runId: 'run-retro',
        personaId: 'proj-a/retrospector/0',
        createdAt: '2026-05-01T00:01:00.000Z',
      },
    ]);
    mockDb.all.mockReturnValue([{ total: null }]);

    const { archiveLifecycle } = await import('./archive.js');
    archiveLifecycle({ projectId: 'proj-a', workItemId: 'item-1' });

    const inserted = mockDb.values.mock.calls[0][0] as Record<string, unknown>;
    const learnings = JSON.parse(inserted.learningEntries as string) as unknown[];
    const scores = JSON.parse(inserted.qualityScores as string) as unknown[];
    expect(learnings).toHaveLength(1);
    expect(scores).toHaveLength(1);
  });

  it('collects unique runIds from events', async () => {
    const { eventStore } = await import('../event-stream/store.js');
    vi.mocked(eventStore.replay).mockReturnValue([
      {
        id: 1,
        projectId: 'p',
        workItemId: 'w',
        kind: 'agent.run-started',
        payload: {},
        runId: 'run-1',
        personaId: null,
        createdAt: '',
      },
      {
        id: 2,
        projectId: 'p',
        workItemId: 'w',
        kind: 'agent.decision-summary',
        payload: { kind: 'PLAN', summary: 's' },
        runId: 'run-1',
        personaId: 'p/dev/0',
        createdAt: '',
      },
      {
        id: 3,
        projectId: 'p',
        workItemId: 'w',
        kind: 'agent.run-started',
        payload: {},
        runId: 'run-2',
        personaId: null,
        createdAt: '',
      },
    ]);
    mockDb.all.mockReturnValue([{ total: 0.5 }]);

    const { archiveLifecycle } = await import('./archive.js');
    archiveLifecycle({ projectId: 'p', workItemId: 'w' });

    const inserted = mockDb.values.mock.calls[0][0] as Record<string, unknown>;
    const runIds = JSON.parse(inserted.runIds as string) as string[];
    expect(runIds).toHaveLength(2);
    expect(runIds).toContain('run-1');
    expect(runIds).toContain('run-2');
    expect(inserted.costsUsd).toBe(0.5);
  });
});

// ─── minePatterns tests ───────────────────────────────────────────────────────

describe('minePatterns', () => {
  beforeEach(resetMockDb);

  it('does nothing when archive is empty', async () => {
    mockDb.all.mockReturnValue([]);

    const { minePatterns } = await import('./mine.js');
    minePatterns({ projectId: 'proj-a' });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('groups decision summaries by (kind, role) correctly', async () => {
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        workItemId: 'item-1',
        decisionSummaries: JSON.stringify([
          {
            kind: 'PLAN',
            role: 'developer',
            summary: 'Used TDD approach',
            personaId: 'proj-a/developer/0',
          },
          {
            kind: 'PLAN',
            role: 'developer',
            summary: 'Used TDD approach',
            personaId: 'proj-a/developer/1',
          },
          { kind: 'VERDICT', role: 'qa', summary: 'Tests pass', personaId: 'proj-a/qa/0' },
        ]),
      }),
    ]);

    const insertedRows: unknown[] = [];
    mockDb.onConflictDoUpdate.mockReturnValue({ run: vi.fn() });
    mockDb.values.mockImplementation((v: unknown) => {
      insertedRows.push(v);
      return mockDb;
    });

    const { minePatterns } = await import('./mine.js');
    minePatterns({ projectId: 'proj-a' });

    expect(insertedRows).toHaveLength(2);
    const planRow = (insertedRows as Array<Record<string, unknown>>).find(
      (r) => r.kind === 'PLAN' && r.role === 'developer',
    );
    const verdictRow = (insertedRows as Array<Record<string, unknown>>).find(
      (r) => r.kind === 'VERDICT' && r.role === 'qa',
    );
    expect(planRow).toBeDefined();
    expect(verdictRow).toBeDefined();
  });

  it('computes consistencyScore = topActionCount / totalCount', async () => {
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        workItemId: 'item-1',
        decisionSummaries: JSON.stringify([
          { kind: 'PLAN', role: 'developer', summary: 'TDD', personaId: '' },
          { kind: 'PLAN', role: 'developer', summary: 'TDD', personaId: '' },
          { kind: 'PLAN', role: 'developer', summary: 'spike first', personaId: '' },
        ]),
      }),
    ]);

    const insertedRows: unknown[] = [];
    mockDb.onConflictDoUpdate.mockReturnValue({ run: vi.fn() });
    mockDb.values.mockImplementation((v: unknown) => {
      insertedRows.push(v);
      return mockDb;
    });

    const { minePatterns } = await import('./mine.js');
    minePatterns({ projectId: 'proj-a' });

    const row = (insertedRows as Array<Record<string, unknown>>)[0];
    // 'TDD' appears 2 out of 3 times → 2/3 ≈ 0.667
    expect(row?.consistencyScore).toBeCloseTo(2 / 3);
    expect(row?.actionSummary).toBe('TDD');
    expect(row?.occurrenceCount).toBe(3);
  });

  it('scores 1.0 when all summaries are identical', async () => {
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        decisionSummaries: JSON.stringify([
          { kind: 'COMMIT', role: 'developer', summary: 'committed changes', personaId: '' },
          { kind: 'COMMIT', role: 'developer', summary: 'committed changes', personaId: '' },
          { kind: 'COMMIT', role: 'developer', summary: 'committed changes', personaId: '' },
        ]),
      }),
    ]);

    const insertedRows: unknown[] = [];
    mockDb.onConflictDoUpdate.mockReturnValue({ run: vi.fn() });
    mockDb.values.mockImplementation((v: unknown) => {
      insertedRows.push(v);
      return mockDb;
    });

    const { minePatterns } = await import('./mine.js');
    minePatterns({ projectId: 'proj-a' });

    const row = (insertedRows as Array<Record<string, unknown>>)[0];
    expect(row?.consistencyScore).toBe(1);
  });

  it('caps exampleWorkItemIds at 5', async () => {
    const summaries = Array.from({ length: 8 }, (_) => ({
      kind: 'READ',
      role: 'developer',
      summary: 's',
      personaId: '',
    }));
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeLifecycleRow({
        workItemId: `item-${i}`,
        decisionSummaries: JSON.stringify([summaries[i]]),
      }),
    );
    mockDb.all.mockReturnValue(rows);

    const insertedRows: unknown[] = [];
    mockDb.onConflictDoUpdate.mockReturnValue({ run: vi.fn() });
    mockDb.values.mockImplementation((v: unknown) => {
      insertedRows.push(v);
      return mockDb;
    });

    const { minePatterns } = await import('./mine.js');
    minePatterns({ projectId: 'proj-a' });

    const row = (insertedRows as Array<Record<string, unknown>>)[0];
    const exampleIds = JSON.parse(row?.exampleWorkItemIds as string) as string[];
    expect(exampleIds.length).toBeLessThanOrEqual(5);
  });
});

// ─── computeTrend tests ───────────────────────────────────────────────────────

describe('computeTrend', () => {
  beforeEach(resetMockDb);

  it('returns stable with sampleCount=0 for empty archive', async () => {
    mockDb.all.mockReturnValue([]);

    const { computeTrend } = await import('./convergence.js');
    const result = computeTrend({ projectId: 'proj-a', role: 'developer' });

    expect(result.trend).toBe('stable');
    expect(result.sampleCount).toBe(0);
    expect(result.delta).toBe(0);
  });

  it('returns stable with sampleCount=0 when no scores match the role', async () => {
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        qualityScores: JSON.stringify([
          { personaId: 'proj-a/qa/0', score: 0.9, trend: 'stable', sampleCount: 1, rationale: '' },
        ]),
      }),
    ]);

    const { computeTrend } = await import('./convergence.js');
    const result = computeTrend({ projectId: 'proj-a', role: 'developer' });

    expect(result.trend).toBe('stable');
    expect(result.sampleCount).toBe(0);
  });

  it('returns stable for single sample', async () => {
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        qualityScores: JSON.stringify([
          {
            personaId: 'proj-a/developer/0',
            score: 0.8,
            trend: 'stable',
            sampleCount: 1,
            rationale: '',
          },
        ]),
      }),
    ]);

    const { computeTrend } = await import('./convergence.js');
    const result = computeTrend({ projectId: 'proj-a', role: 'developer' });

    expect(result.trend).toBe('stable');
    expect(result.sampleCount).toBe(1);
  });

  it('returns improving for rising window (delta > 0.05)', async () => {
    // Window of 4 lifecycles with scores 0.5, 0.6, 0.8, 0.9
    // early half avg = (0.5 + 0.6) / 2 = 0.55
    // late half avg = (0.8 + 0.9) / 2 = 0.85
    // delta = 0.30 > 0.05 → improving
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        closedAt: '2026-05-01T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.9 }]),
      }),
      makeLifecycleRow({
        closedAt: '2026-05-02T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.8 }]),
      }),
      makeLifecycleRow({
        closedAt: '2026-05-03T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.6 }]),
      }),
      makeLifecycleRow({
        closedAt: '2026-05-04T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.5 }]),
      }),
    ]);

    const { computeTrend } = await import('./convergence.js');
    // rows returned desc order (newest first), reversed to chron: 0.5, 0.6, 0.8, 0.9
    const result = computeTrend({ projectId: 'p', role: 'developer' });

    expect(result.trend).toBe('improving');
    expect(result.delta).toBeGreaterThan(0.05);
  });

  it('returns declining for falling window (delta < -0.05)', async () => {
    // scores in chron order: 0.9, 0.8, 0.6, 0.5
    // early half avg = 0.85, late half avg = 0.55, delta = -0.30
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        closedAt: '2026-05-01T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.5 }]),
      }),
      makeLifecycleRow({
        closedAt: '2026-05-02T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.6 }]),
      }),
      makeLifecycleRow({
        closedAt: '2026-05-03T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.8 }]),
      }),
      makeLifecycleRow({
        closedAt: '2026-05-04T00:00:00.000Z',
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.9 }]),
      }),
    ]);

    const { computeTrend } = await import('./convergence.js');
    // rows returned desc (newest first), reversed to chron: 0.9, 0.8, 0.6, 0.5
    const result = computeTrend({ projectId: 'p', role: 'developer' });

    expect(result.trend).toBe('declining');
    expect(result.delta).toBeLessThan(-0.05);
  });

  it('returns stable for flat window (delta within ±0.05)', async () => {
    // scores: 0.8, 0.81, 0.79, 0.80 — tiny variance
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.8 }]),
      }),
      makeLifecycleRow({
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.79 }]),
      }),
      makeLifecycleRow({
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.81 }]),
      }),
      makeLifecycleRow({
        qualityScores: JSON.stringify([{ personaId: 'p/developer/0', score: 0.8 }]),
      }),
    ]);

    const { computeTrend } = await import('./convergence.js');
    const result = computeTrend({ projectId: 'p', role: 'developer' });

    expect(result.trend).toBe('stable');
    expect(Math.abs(result.delta)).toBeLessThanOrEqual(0.05);
  });

  it('filters scores by role from personaId', async () => {
    // Mix of developer and qa scores — should only use developer
    mockDb.all.mockReturnValue([
      makeLifecycleRow({
        qualityScores: JSON.stringify([
          { personaId: 'p/developer/0', score: 0.9 },
          { personaId: 'p/qa/0', score: 0.2 },
        ]),
      }),
      makeLifecycleRow({
        qualityScores: JSON.stringify([
          { personaId: 'p/developer/0', score: 0.85 },
          { personaId: 'p/qa/0', score: 0.3 },
        ]),
      }),
    ]);

    const { computeTrend } = await import('./convergence.js');
    const result = computeTrend({ projectId: 'p', role: 'developer' });

    // developer scores: [0.85, 0.9] chron order (desc returned, reversed)
    // With 2 samples: half=1, earlyScores=[0.85], lateScores=[0.9]
    // delta = 0.9 - 0.85 = 0.05 (on the boundary → stable)
    expect(result.sampleCount).toBe(2);
    expect(['stable', 'improving']).toContain(result.trend);
  });
});
