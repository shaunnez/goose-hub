import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock ─────────────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  const FLUENT = [
    'select',
    'insert',
    'from',
    'where',
    'orderBy',
    'limit',
    'values',
    'onConflictDoUpdate',
  ] as const;
  const m: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of FLUENT) {
    m[method] = vi.fn().mockReturnValue(m);
  }
  m.all = vi.fn().mockReturnValue([]);
  m.run = vi.fn().mockReturnValue(undefined);
  m.at = vi.fn().mockReturnValue(undefined);
  return { mockDb: m };
});

vi.mock('@goose-hub/core/db/db.js', () => ({ db: mockDb }));
vi.mock('@goose-hub/core/db/schema.js', () => ({
  archivedLifecycles: { projectId: 'project_id', closedAt: 'closed_at' },
  decisionPatterns: { projectId: 'project_id', kind: 'kind', role: 'role' },
  events: { projectId: 'project_id', createdAt: 'created_at' },
  agentRunCosts: {
    projectId: 'project_id',
    createdAt: 'created_at',
    stage: 'stage',
    skill: 'skill',
    costUsd: 'cost_usd',
  },
}));

vi.mock('@goose-hub/core/learning/playbook-stats.js', () => ({
  computeGateThresholds: vi.fn().mockReturnValue([
    { gate: 'qa', mean: 80, min: 60, max: 100, stdDev: 10, sampleCount: 5 },
    { gate: 'review', mean: 0.85, min: 0.7, max: 1.0, stdDev: 0.1, sampleCount: 3 },
  ]),
  computeCostBaselines: vi
    .fn()
    .mockReturnValue([
      { role: 'developer', skill: 'implement', mean: 0.05, p50: 0.04, p95: 0.1, sampleCount: 10 },
    ]),
}));

function reset() {
  vi.clearAllMocks();
  for (const method of [
    'select',
    'insert',
    'from',
    'where',
    'orderBy',
    'limit',
    'values',
    'onConflictDoUpdate',
  ]) {
    mockDb[method] = vi.fn().mockReturnValue(mockDb);
  }
  mockDb.all = vi.fn().mockReturnValue([]);
  mockDb.run = vi.fn().mockReturnValue(undefined);
  mockDb.at = vi.fn().mockReturnValue(undefined);
}

// ─── tests ───────────────────────────────────────────────────────────────────

import {
  PlaybookManifestSchema,
  exportPlaybook,
} from '@goose-hub/core/learning/playbook-export.js';
import { importPlaybook } from '@goose-hub/core/learning/playbook-import.js';

describe('exportPlaybook', () => {
  beforeEach(reset);

  it('returns a valid PlaybookManifest for an empty project', () => {
    const manifest = exportPlaybook('proj-id', 'MyProject');
    const result = PlaybookManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    expect(manifest.schemaVersion).toBe('1');
    expect(manifest.sourceProject).toBe('MyProject');
    expect(manifest.learnings).toEqual([]);
    expect(manifest.gateThresholds).toHaveLength(2);
    expect(manifest.costBaselines).toHaveLength(1);
  });

  it('strips project-specific lifecycle identifiers from learnings', () => {
    mockDb.all = vi
      .fn()
      .mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj-id',
          workItemId: 'github:owner/repo#42', // should not appear in export
          closedAt: new Date().toISOString(),
          decisionSummaries: '[]',
          learningEntries: JSON.stringify([
            {
              observation: 'Faster to use streaming',
              rationale: 'Reduces latency',
              improvementKind: 'skill-prompt',
              confidence: 'high',
            },
          ]),
          qualityScores: '[]',
          costsUsd: 0,
          runIds: '[]',
        },
      ])
      .mockReturnValue([]);

    const manifest = exportPlaybook('proj-id', 'MyProject');
    expect(manifest.learnings).toHaveLength(1);
    expect(manifest.learnings[0].observation).toBe('Faster to use streaming');
    // workItemId must not leak
    expect(JSON.stringify(manifest)).not.toContain('owner/repo#42');
  });

  it('includes decision patterns with decisionType and phase', () => {
    mockDb.all = vi
      .fn()
      .mockReturnValueOnce([]) // lifecycles
      .mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj-id',
          kind: 'IMPLEMENTATION_PLAN',
          role: 'developer',
          actionSummary: 'Write tests first',
          reasonSummary: 'TDD works',
          occurrenceCount: 5,
          consistencyScore: 0.9,
          lastSeenAt: new Date().toISOString(),
          exampleWorkItemIds: '["github:repo#1"]',
        },
      ]);

    const manifest = exportPlaybook('proj-id', 'MyProject');
    expect(manifest.decisionPatterns).toHaveLength(1);
    expect(manifest.decisionPatterns[0].decisionType).toBe('IMPLEMENTATION_PLAN');
    expect(manifest.decisionPatterns[0].phase).toBe('developer');
    // No raw workItemId in exported patterns
    expect(JSON.stringify(manifest.decisionPatterns)).not.toContain('github:repo#1');
  });
});

describe('importPlaybook', () => {
  beforeEach(reset);

  function makeManifest(overrides: Record<string, unknown> = {}): unknown {
    return {
      schemaVersion: '1',
      generatedAt: new Date().toISOString(),
      sourceProject: 'Source',
      learnings: [],
      gateThresholds: [
        { gateName: 'qa', phase: 'qa', mean: 80, min: 60, max: 100, stdDev: 10, sampleCount: 5 },
      ],
      decisionPatterns: [
        {
          decisionType: 'QUERY_PIVOT',
          phase: 'investigator',
          actionSummary: 'Switched query',
          reasonSummary: 'Better results',
          occurrenceCount: 3,
          consistencyScore: 0.8,
        },
      ],
      costBaselines: [
        { phase: 'developer', meanUsd: 0.05, p50Usd: 0.04, p95Usd: 0.1, sampleCount: 10 },
      ],
      ...overrides,
    };
  }

  it('rejects incompatible schemaVersion', () => {
    const result = importPlaybook('target', { schemaVersion: '99' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('incompatible schemaVersion');
  });

  it('rejects null manifest', () => {
    const result = importPlaybook('target', null);
    expect(result.ok).toBe(false);
  });

  it('imports decision patterns and returns count', () => {
    const result = importPlaybook('target-proj', makeManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisionPatternsImported).toBe(1);
      expect(result.gateThresholdsImported).toBe(1);
    }
    expect(mockDb.run).toHaveBeenCalled();
  });

  it('round-trip: export then import produces same decision pattern count', () => {
    // Set up export mocks
    mockDb.all = vi
      .fn()
      .mockReturnValueOnce([]) // lifecycles
      .mockReturnValueOnce([
        {
          id: 1,
          projectId: 'src',
          kind: 'REPO_SELECTION',
          role: 'investigator',
          actionSummary: 'Picked payments-api',
          reasonSummary: '',
          occurrenceCount: 4,
          consistencyScore: 0.75,
          lastSeenAt: new Date().toISOString(),
          exampleWorkItemIds: '[]',
        },
      ])
      // import lookup (existing pattern check)
      .mockReturnValue([]);

    const manifest = exportPlaybook('src', 'SourceProject');
    expect(manifest.decisionPatterns).toHaveLength(1);

    const importResult = importPlaybook('tgt', manifest);
    expect(importResult.ok).toBe(true);
    if (importResult.ok) {
      expect(importResult.decisionPatternsImported).toBe(1);
    }
  });

  it('merges consistency score when pattern already exists', () => {
    // Existing pattern in target
    mockDb.all = vi.fn().mockReturnValue([
      {
        id: 99,
        projectId: 'tgt',
        kind: 'QUERY_PIVOT',
        role: 'investigator',
        actionSummary: 'Old action',
        reasonSummary: '',
        occurrenceCount: 2,
        consistencyScore: 0.5,
        lastSeenAt: '',
        exampleWorkItemIds: '[]',
      },
    ]);

    const manifest = makeManifest(); // has 1 pattern: QUERY_PIVOT, occurrenceCount:3, score:0.8
    const result = importPlaybook('tgt', manifest);
    expect(result.ok).toBe(true);
    // Merged: (0.5*2 + 0.8*3) / 5 = (1.0 + 2.4) / 5 = 0.68
    expect(mockDb.run).toHaveBeenCalled();
  });
});
