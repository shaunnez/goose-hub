import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db.js';
import { archivedLifecycles, decisionPatterns } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import type { DecisionSummary, LearningEntry, QualityScore } from '../retrospective/schemas.js';
import { archiveLifecycle } from './archive.js';
import { computeTrend } from './convergence.js';
import { minePatterns } from './mine.js';

// ─── mocks ─────────────────────────────────────────────────────────────────

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    replay: vi.fn(),
  },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

function clearTables() {
  db.delete(archivedLifecycles).run();
  db.delete(decisionPatterns).run();
}

// ─── archive lifecycle ─────────────────────────────────────────────────────

describe('archiveLifecycle', () => {
  beforeEach(() => {
    clearTables();
    vi.clearAllMocks();
  });

  it('writes decision summaries, learning entries, quality scores to archived_lifecycles', () => {
    const mockEvents = [
      {
        id: 1,
        projectId: 'test-project',
        workItemId: 'test-item',
        kind: 'agent.decision-summary' as const,
        createdAt: '2024-01-01T00:00:00Z',
        payload: {
          kind: 'PLAN',
          summary: 'Add helper function',
          evidence: 'Mirrors existing pattern',
        },
      },
      {
        id: 2,
        projectId: 'test-project',
        workItemId: 'test-item',
        kind: 'agent.decision-summary' as const,
        createdAt: '2024-01-01T00:00:00Z',
        payload: {
          kind: 'RED',
          summary: 'Write failing tests',
        },
      },
      {
        id: 3,
        projectId: 'test-project',
        workItemId: 'test-item',
        kind: 'retrospective.completed' as const,
        createdAt: '2024-01-01T00:00:00Z',
        payload: {
          output: {
            learningEntries: [
              {
                observation: 'TDD discipline helped',
                rationale: 'Zero regressions',
                improvementKind: 'workflow' as const,
                confidence: 'high' as const,
              },
            ],
            personaQualityScores: [
              {
                personaId: 'test-project/developer/0',
                score: 0.92,
                trend: 'stable' as const,
                sampleCount: 1,
                rationale: 'Clean impl',
              },
            ],
          },
        },
      },
    ];

    vi.mocked(eventStore.replay).mockReturnValueOnce(mockEvents);
    vi.spyOn(db, 'select').mockReturnValueOnce({
      from: () => ({
        where: () => ({
          all: () => [{ workItemId: 'test-item', costUsd: 2.5, runId: 'run-1' }],
        }),
      }),
    } as never);

    archiveLifecycle({ projectId: 'test-project', workItemId: 'test-item' });

    const inserted = db
      .select()
      .from(archivedLifecycles)
      .where(eq(archivedLifecycles.workItemId, 'test-item'))
      .all();

    expect(inserted.length).toBe(1);
    const row = inserted[0];
    expect(row.projectId).toBe('test-project');
    expect(row.workItemId).toBe('test-item');
    expect(row.costsUsd).toBe(2.5);

    const decisions = JSON.parse(row.decisionSummaries as string);
    expect(decisions.length).toBe(2);
    expect(decisions[0].kind).toBe('PLAN');
    expect(decisions[1].kind).toBe('RED');

    const learning = JSON.parse(row.learningEntries as string);
    expect(learning.length).toBe(1);
    expect(learning[0].observation).toContain('TDD');
  });

  it('skips duplicate decision summaries (same kind + summary)', () => {
    const mockEvents = [
      {
        id: 1,
        projectId: 'test-project',
        workItemId: 'test-item',
        kind: 'agent.decision-summary' as const,
        createdAt: '2024-01-01T00:00:00Z',
        payload: {
          kind: 'PLAN',
          summary: 'Same decision',
        },
      },
      {
        id: 2,
        projectId: 'test-project',
        workItemId: 'test-item',
        kind: 'agent.decision-summary' as const,
        createdAt: '2024-01-01T00:00:00Z',
        payload: {
          kind: 'PLAN',
          summary: 'Same decision',
        },
      },
    ];

    vi.mocked(eventStore.replay).mockReturnValueOnce(mockEvents);
    vi.spyOn(db, 'select').mockReturnValueOnce({
      from: () => ({
        where: () => ({
          all: () => [],
        }),
      }),
    } as never);

    archiveLifecycle({ projectId: 'test-project', workItemId: 'test-item' });

    const inserted = db.select().from(archivedLifecycles).all();

    const decisions = JSON.parse(inserted[0].decisionSummaries as string);
    expect(decisions.length).toBe(1);
  });

  it('handles empty events gracefully', () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    vi.spyOn(db, 'select').mockReturnValueOnce({
      from: () => ({
        where: () => ({
          all: () => [],
        }),
      }),
    } as never);

    archiveLifecycle({ projectId: 'test-project', workItemId: 'test-item' });

    const inserted = db.select().from(archivedLifecycles).all();

    expect(inserted.length).toBe(1);
    const row = inserted[0];
    expect(JSON.parse(row.decisionSummaries as string)).toEqual([]);
    expect(JSON.parse(row.learningEntries as string)).toEqual([]);
  });
});

// ─── mine patterns ──────────────────────────────────────────────────────────

describe('minePatterns', () => {
  beforeEach(() => {
    clearTables();
    vi.clearAllMocks();
  });

  it('groups decisions by (kind, role) and computes consistency score', () => {
    const decisions1: DecisionSummary[] = [
      { kind: 'PLAN', summary: 'Add feature X', evidence: undefined },
      { kind: 'RED', summary: 'Write tests', evidence: undefined },
    ];
    const decisions2: DecisionSummary[] = [
      { kind: 'PLAN', summary: 'Refactor Y', evidence: undefined },
    ];

    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: new Date(Date.now() - 2000).toISOString(),
          decisionSummaries: JSON.stringify(decisions1),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: new Date(Date.now() - 1000).toISOString(),
          decisionSummaries: JSON.stringify(decisions2),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    minePatterns({ projectId: 'test-project' });

    const patterns = db.select().from(decisionPatterns).all();

    expect(patterns.length).toBe(2); // PLAN (2 occurrences) and RED (1)
    const planPattern = patterns.find((p) => p.kind === 'PLAN');
    expect(planPattern).toBeDefined();
    expect(planPattern?.occurrenceCount).toBe(2);
    expect(planPattern?.consistencyScore).toBeCloseTo(2 / 2); // 2 plans out of 2 total
  });

  it('computes consistency score as occurrence count / total lifecycles', () => {
    const decisions: DecisionSummary[] = [{ kind: 'PLAN', summary: 'Common decision' }];

    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: new Date().toISOString(),
          decisionSummaries: JSON.stringify(decisions),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: new Date().toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    minePatterns({ projectId: 'test-project' });

    const pattern = db.select().from(decisionPatterns).all()[0];

    expect(pattern.consistencyScore).toBeCloseTo(0.5); // 1 occurrence / 2 lifecycles
  });

  it('skips malformed JSON gracefully', () => {
    db.insert(archivedLifecycles)
      .values({
        projectId: 'test-project',
        workItemId: 'item-1',
        closedAt: new Date().toISOString(),
        decisionSummaries: 'invalid json {',
        learningEntries: JSON.stringify([]),
        qualityScores: JSON.stringify([]),
        costsUsd: 1,
        runIds: JSON.stringify([]),
      })
      .run();

    expect(() => {
      minePatterns({ projectId: 'test-project' });
    }).not.toThrow();

    const patterns = db.select().from(decisionPatterns).all();
    expect(patterns.length).toBe(0);
  });

  it('returns early if no lifecycles exist', () => {
    minePatterns({ projectId: 'empty-project' });

    const patterns = db.select().from(decisionPatterns).all();
    expect(patterns.length).toBe(0);
  });

  it('uses since parameter to filter by closedAt', () => {
    const decisions: DecisionSummary[] = [{ kind: 'PLAN', summary: 'Old decision' }];
    const oldTime = new Date(Date.now() - 10000).toISOString();
    const newTime = new Date(Date.now() - 1000).toISOString();

    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: oldTime,
          decisionSummaries: JSON.stringify(decisions),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: newTime,
          decisionSummaries: JSON.stringify(decisions),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    // Mine only recent decisions
    const sinceTime = new Date(Date.now() - 5000).toISOString();
    minePatterns({ projectId: 'test-project', since: sinceTime });

    const pattern = db.select().from(decisionPatterns).all()[0];

    expect(pattern.occurrenceCount).toBe(1); // Only item-2 should be included
  });
});

// ─── compute trend ──────────────────────────────────────────────────────────

describe('computeTrend', () => {
  beforeEach(() => {
    clearTables();
    vi.clearAllMocks();
  });

  it('returns improving when delta > 0.05', () => {
    const now = Date.now();
    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: new Date(now - 3000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.6, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: new Date(now - 2000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.7, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    const trend = computeTrend({ projectId: 'test-project', role: 'developer' });
    expect(trend).toBe('improving');
  });

  it('returns declining when delta < -0.05', () => {
    const now = Date.now();
    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: new Date(now - 2000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.9, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: new Date(now - 1000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.8, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    const trend = computeTrend({ projectId: 'test-project', role: 'developer' });
    expect(trend).toBe('declining');
  });

  it('returns stable when delta is between -0.05 and 0.05', () => {
    const now = Date.now();
    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: new Date(now - 2000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.8, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: new Date(now - 1000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.82, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    const trend = computeTrend({ projectId: 'test-project', role: 'developer' });
    expect(trend).toBe('stable');
  });

  it('returns stable when fewer than 2 lifecycles exist', () => {
    db.insert(archivedLifecycles)
      .values({
        projectId: 'test-project',
        workItemId: 'item-1',
        closedAt: new Date().toISOString(),
        decisionSummaries: JSON.stringify([]),
        learningEntries: JSON.stringify([]),
        qualityScores: JSON.stringify([
          { personaId: 'dev', score: 0.85, trend: 'stable', sampleCount: 1, rationale: 'test' },
        ]),
        costsUsd: 1,
        runIds: JSON.stringify([]),
      })
      .run();

    const trend = computeTrend({ projectId: 'test-project', role: 'developer' });
    expect(trend).toBe('stable');
  });

  it('respects windowSize parameter', () => {
    const now = Date.now();
    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: new Date(now - 5000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.5, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: new Date(now - 4000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.6, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-3',
          closedAt: new Date(now - 3000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.95, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    // With windowSize=2, should only see item-3 and item-2, computing delta
    const trend = computeTrend({ projectId: 'test-project', role: 'developer', windowSize: 2 });
    // item-2 (0.60) to item-3 (0.95) = 0.35 delta > 0.05 = improving
    expect(trend).toBe('improving');
  });

  it('handles malformed quality scores JSON gracefully', () => {
    const now = Date.now();
    db.insert(archivedLifecycles)
      .values([
        {
          projectId: 'test-project',
          workItemId: 'item-1',
          closedAt: new Date(now - 2000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: 'invalid json {',
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
        {
          projectId: 'test-project',
          workItemId: 'item-2',
          closedAt: new Date(now - 1000).toISOString(),
          decisionSummaries: JSON.stringify([]),
          learningEntries: JSON.stringify([]),
          qualityScores: JSON.stringify([
            { personaId: 'dev', score: 0.85, trend: 'stable', sampleCount: 1, rationale: 'test' },
          ]),
          costsUsd: 1,
          runIds: JSON.stringify([]),
        },
      ])
      .run();

    const trend = computeTrend({ projectId: 'test-project', role: 'developer' });
    expect(trend).toBe('stable'); // Falls back because only 1 valid score
  });

  it('returns stable for empty project', () => {
    const trend = computeTrend({ projectId: 'nonexistent', role: 'developer' });
    expect(trend).toBe('stable');
  });
});
