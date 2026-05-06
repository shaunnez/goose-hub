import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRun = vi.fn();
const mockAppendEvent = vi.fn().mockReturnValue({ id: 1 });
const mockComputeGateThresholds = vi.fn();
const mockComputeCostBaselines = vi.fn();
const mockFetchLifecyclesInWindow = vi.fn();
const mockGetProjectBySlug = vi.fn().mockResolvedValue(null);
const mockSelectPersona = vi
  .fn()
  .mockReturnValue({ personaId: 'test-project/retrospector/0', codename: 'Tester' });

const { mockDb } = vi.hoisted(() => {
  const FLUENT = ['select', 'from', 'where', 'insert', 'values', 'returning'] as const;
  const mockDb: Record<string, unknown> = {};
  for (const method of FLUENT) {
    mockDb[method] = vi.fn().mockReturnValue(mockDb);
  }
  mockDb.all = vi.fn().mockReturnValue([]);
  mockDb.run = vi.fn();
  return { mockDb: mockDb as Record<string, ReturnType<typeof vi.fn>> };
});

vi.mock('../db/db.js', () => ({ db: mockDb }));
vi.mock('../db/schema.js', () => ({
  archivedLifecycles: { projectId: 'project_id', closedAt: 'closed_at' },
  decisionPatterns: { projectId: 'project_id' },
  playbooks: { id: 'id' },
}));
vi.mock('../agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));
vi.mock('../agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));
vi.mock('../agent-runtime/select-persona.js', () => ({
  selectPersona: (...args: unknown[]) => mockSelectPersona(...args),
}));
vi.mock('../agent-runtime/read-prompt.js', () => ({
  readPromptWithContext: vi.fn().mockReturnValue('# mock cross-run prompt'),
}));
vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('../learning/playbook-stats.js', () => ({
  computeGateThresholds: (...args: unknown[]) => mockComputeGateThresholds(...args),
  computeCostBaselines: (...args: unknown[]) => mockComputeCostBaselines(...args),
  fetchLifecyclesInWindow: (...args: unknown[]) => mockFetchLifecyclesInWindow(...args),
}));
vi.mock('../projects/loader.js', () => ({
  getProjectBySlug: (...args: unknown[]) => mockGetProjectBySlug(...args),
}));

import {
  CrossRunRetroInputError,
  dispatchCoachCandidates,
  resolveWindow,
  runCrossRunRetroWorkflow,
} from './cross-run-retro.js';

function makeManifestOutput(overrides: Record<string, unknown> = {}) {
  return {
    output: {
      outcome: 'success',
      workItemNumber: 0,
      windowStartAt: '2026-04-01T00:00:00.000Z',
      windowEndAt: '2026-05-01T00:00:00.000Z',
      lifecycleCount: 2,
      summary: {
        wentWell: 'TDD discipline',
        didNotGoWell: 'Out-of-scope edits',
        architecturalTakeaway: 'Formalize ACs',
      },
      aggregatedLearnings: [],
      topPatterns: [],
      gateThresholds: [],
      costBaselines: [],
      improvementCandidates: [],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Cross-run retro complete' }],
      ...overrides,
    },
    decisionSummaries: [],
    events: [],
  };
}

beforeEach(() => {
  mockRun.mockReset();
  mockAppendEvent.mockClear();
  mockComputeGateThresholds.mockReset().mockReturnValue([]);
  mockComputeCostBaselines.mockReset().mockReturnValue([]);
  mockFetchLifecyclesInWindow.mockReset().mockReturnValue([]);
  mockSelectPersona.mockClear();
  for (const method of ['select', 'from', 'where', 'insert', 'values', 'returning']) {
    mockDb[method] = vi.fn().mockReturnValue(mockDb);
  }
  mockDb.all = vi.fn().mockReturnValue([]);
  mockDb.run = vi.fn();
});

describe('resolveWindow', () => {
  it('throws when neither windowSize nor dateRange supplied', () => {
    expect(() => resolveWindow({ projectId: 'p' })).toThrow(CrossRunRetroInputError);
  });

  it('throws when both windowSize and dateRange supplied', () => {
    expect(() =>
      resolveWindow({
        projectId: 'p',
        windowSize: 5,
        dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
      }),
    ).toThrow(CrossRunRetroInputError);
  });

  it('echoes dateRange verbatim', () => {
    const w = resolveWindow({
      projectId: 'p',
      dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
    });
    expect(w).toEqual({ startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' });
  });

  it('rejects inverted dateRange', () => {
    expect(() =>
      resolveWindow({
        projectId: 'p',
        dateRange: { startAt: '2026-05-01T00:00:00Z', endAt: '2026-04-01T00:00:00Z' },
      }),
    ).toThrow(CrossRunRetroInputError);
  });

  it('rejects non-positive windowSize', () => {
    expect(() => resolveWindow({ projectId: 'p', windowSize: 0 })).toThrow(CrossRunRetroInputError);
    expect(() => resolveWindow({ projectId: 'p', windowSize: -1 })).toThrow(
      CrossRunRetroInputError,
    );
  });

  it('windowSize on empty archive collapses to (now, now)', () => {
    mockDb.all = vi.fn().mockReturnValue([]);
    const now = new Date('2026-05-06T00:00:00.000Z');
    const w = resolveWindow({ projectId: 'p', windowSize: 5, deps: { now: () => now } });
    expect(w.startAt).toBe(now.toISOString());
    expect(w.endAt).toBe(now.toISOString());
  });

  it('windowSize selects Nth most recent closedAt as startAt', () => {
    mockDb.all = vi
      .fn()
      .mockReturnValue([
        { closedAt: '2026-05-01T00:00:00Z' },
        { closedAt: '2026-04-29T00:00:00Z' },
        { closedAt: '2026-04-27T00:00:00Z' },
        { closedAt: '2026-04-25T00:00:00Z' },
        { closedAt: '2026-04-23T00:00:00Z' },
      ]);
    const now = new Date('2026-05-06T00:00:00.000Z');
    const w = resolveWindow({ projectId: 'p', windowSize: 3, deps: { now: () => now } });
    // 3rd most recent = 2026-04-27
    expect(w.startAt).toBe('2026-04-27T00:00:00Z');
    expect(w.endAt).toBe(now.toISOString());
  });

  it('windowSize > available falls back to oldest closedAt', () => {
    mockDb.all = vi.fn().mockReturnValue([{ closedAt: '2026-05-01T00:00:00Z' }]);
    const now = new Date('2026-05-06T00:00:00.000Z');
    const w = resolveWindow({ projectId: 'p', windowSize: 99, deps: { now: () => now } });
    expect(w.startAt).toBe('2026-05-01T00:00:00Z');
  });
});

describe('runCrossRunRetroWorkflow', () => {
  it('happy path: persists playbook with manifest + emits retrospective.completed', async () => {
    mockFetchLifecyclesInWindow.mockReturnValue([
      {
        id: 1,
        projectId: 'p',
        workItemId: 'github:o/r#1',
        closedAt: '2026-04-15T00:00:00Z',
        decisionSummaries: '[]',
        learningEntries: '[]',
        qualityScores: '[]',
        costsUsd: 0.5,
        runIds: '[]',
      },
      {
        id: 2,
        projectId: 'p',
        workItemId: 'github:o/r#2',
        closedAt: '2026-04-20T00:00:00Z',
        decisionSummaries: '[]',
        learningEntries: '[]',
        qualityScores: '[]',
        costsUsd: 0.6,
        runIds: '[]',
      },
    ]);
    mockComputeGateThresholds.mockReturnValue([]);
    mockComputeCostBaselines.mockReturnValue([]);
    mockDb.all = vi.fn().mockReturnValue([{ id: 42 }]);
    mockRun.mockResolvedValueOnce(makeManifestOutput({ lifecycleCount: 2 }));

    const result = await runCrossRunRetroWorkflow({
      projectId: 'p',
      dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbookId).toBe(42);
    expect(result.lifecycleCount).toBe(2);
    expect(result.windowStartAt).toBe('2026-04-01T00:00:00Z');
    expect(result.windowEndAt).toBe('2026-05-01T00:00:00Z');

    const events = mockAppendEvent.mock.calls.map((c) => c[0]);
    expect(events.some((e) => e.kind === 'agent.run-started')).toBe(true);
    expect(events.some((e) => e.kind === 'retrospective.completed')).toBe(true);
  });

  it('empty archive case: still produces a playbook over an empty window', async () => {
    mockFetchLifecyclesInWindow.mockReturnValue([]);
    mockComputeGateThresholds.mockReturnValue([
      { gate: 'qa', mean: 0, min: 0, max: 0, stdDev: 0, sampleCount: 0 },
      { gate: 'review', mean: 0, min: 0, max: 0, stdDev: 0, sampleCount: 0 },
    ]);
    mockComputeCostBaselines.mockReturnValue([]);
    mockDb.all = vi.fn().mockReturnValue([{ id: 7 }]);
    mockRun.mockResolvedValueOnce(
      makeManifestOutput({
        lifecycleCount: 0,
        gateThresholds: [
          { gate: 'qa', mean: 0, min: 0, max: 0, stdDev: 0, sampleCount: 0 },
          { gate: 'review', mean: 0, min: 0, max: 0, stdDev: 0, sampleCount: 0 },
        ],
      }),
    );

    const result = await runCrossRunRetroWorkflow({
      projectId: 'p',
      dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lifecycleCount).toBe(0);
  });

  it('window edge case: single lifecycle and no patterns still validates', async () => {
    mockFetchLifecyclesInWindow.mockReturnValue([
      {
        id: 1,
        projectId: 'p',
        workItemId: 'github:o/r#1',
        closedAt: '2026-04-15T00:00:00Z',
        decisionSummaries: '[]',
        learningEntries: '[]',
        qualityScores: '[]',
        costsUsd: 0.5,
        runIds: '[]',
      },
    ]);
    mockComputeGateThresholds.mockReturnValue([]);
    mockComputeCostBaselines.mockReturnValue([]);
    mockDb.all = vi.fn().mockReturnValue([{ id: 99 }]);
    mockRun.mockResolvedValueOnce(makeManifestOutput({ lifecycleCount: 1 }));

    const result = await runCrossRunRetroWorkflow({
      projectId: 'p',
      dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
    });
    expect(result.ok).toBe(true);
  });

  it('returns failure + emits agent.run-failed when output fails schema validation', async () => {
    mockFetchLifecyclesInWindow.mockReturnValue([]);
    mockComputeGateThresholds.mockReturnValue([]);
    mockComputeCostBaselines.mockReturnValue([]);
    mockRun.mockResolvedValueOnce({
      output: { outcome: 'success' /* missing required fields */ },
      decisionSummaries: [],
      events: [],
    });

    const result = await runCrossRunRetroWorkflow({
      projectId: 'p',
      dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
    });

    expect(result.ok).toBe(false);
    const events = mockAppendEvent.mock.calls.map((c) => c[0]);
    expect(events.some((e) => e.kind === 'agent.run-failed')).toBe(true);
  });

  it('returns failure + emits agent.run-failed when runtime throws', async () => {
    mockFetchLifecyclesInWindow.mockReturnValue([]);
    mockComputeGateThresholds.mockReturnValue([]);
    mockComputeCostBaselines.mockReturnValue([]);
    mockRun.mockRejectedValueOnce(new Error('timeout'));

    const result = await runCrossRunRetroWorkflow({
      projectId: 'p',
      dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('timeout');
  });

  it('passes precomputed gate thresholds + cost baselines into the skill context', async () => {
    mockFetchLifecyclesInWindow.mockReturnValue([]);
    mockComputeGateThresholds.mockReturnValue([
      { gate: 'qa', mean: 80, min: 70, max: 90, stdDev: 5, sampleCount: 5 },
    ]);
    mockComputeCostBaselines.mockReturnValue([
      { role: 'developer', skill: 'implement', mean: 0.4, p50: 0.4, p95: 0.7, sampleCount: 5 },
    ]);
    mockDb.all = vi.fn().mockReturnValue([{ id: 1 }]);
    mockRun.mockResolvedValueOnce(makeManifestOutput());

    await runCrossRunRetroWorkflow({
      projectId: 'p',
      dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
    });

    const spec = mockRun.mock.calls[0][0] as {
      context: {
        precomputedGateThresholds: unknown[];
        precomputedCostBaselines: unknown[];
      };
    };
    expect(spec.context.precomputedGateThresholds).toHaveLength(1);
    expect(spec.context.precomputedCostBaselines).toHaveLength(1);
  });
});

// ─── dispatchCoachCandidates — M11.14 auto-trigger ───────────────────────────

function makeManifestWithCandidates(
  patterns: { patternId: string; consistencyScore: number }[],
  candidates: { kind: string; targetPath: string }[],
) {
  return {
    outcome: 'success' as const,
    workItemNumber: 0,
    windowStartAt: '2026-04-01T00:00:00Z',
    windowEndAt: '2026-05-01T00:00:00Z',
    lifecycleCount: 5,
    summary: { wentWell: '', didNotGoWell: '', architecturalTakeaway: '' },
    aggregatedLearnings: [],
    topPatterns: patterns.map((p) => ({
      patternId: p.patternId,
      pattern: 'some pattern',
      occurrenceCount: 3,
      consistencyScore: p.consistencyScore,
      exampleWorkItemIds: [],
    })),
    gateThresholds: [],
    costBaselines: [],
    improvementCandidates: candidates.map((c) => ({
      kind: c.kind as 'skill-prompt' | 'skill-schema' | 'skill-config',
      targetPath: c.targetPath,
      suggestionText: 'improve this',
      evidence: `pattern:${c.kind} ref`,
      confidence: 'high' as const,
    })),
    decisionSummaries: [] as never[],
  };
}

describe('dispatchCoachCandidates', () => {
  it('fires coach runner above threshold with enough lifecycles', async () => {
    const mockCoachRunner = vi.fn().mockResolvedValue({ ok: true });
    const manifest = makeManifestWithCandidates(
      [{ patternId: 'PLAN::developer', consistencyScore: 0.9 }],
      [{ kind: 'skill-prompt', targetPath: 'skills/implement/prompt.md' }],
    );

    await dispatchCoachCandidates({
      projectId: 'p',
      playbookId: 1,
      manifest,
      lifecycleCount: 4,
      lifecycleIds: [1, 2, 3, 4],
      coachPolicy: { enabled: true, consistencyThreshold: 0.8, minLifecycles: 3 },
      coachWorkflowRunner: mockCoachRunner,
    });

    expect(mockCoachRunner).toHaveBeenCalledOnce();
    const call = mockCoachRunner.mock.calls[0][0] as {
      targetSkillName: string;
      sourcePlaybookId: number;
    };
    expect(call.targetSkillName).toBe('implement');
    expect(call.sourcePlaybookId).toBe(1);
    const events = mockAppendEvent.mock.calls.map((c) => c[0]);
    expect(events.some((e) => e.kind === 'coach.dispatch-triggered')).toBe(true);
  });

  it('does not fire when consistencyScore is below threshold', async () => {
    const mockCoachRunner = vi.fn();
    const manifest = makeManifestWithCandidates(
      [{ patternId: 'PLAN::developer', consistencyScore: 0.5 }],
      [{ kind: 'skill-prompt', targetPath: 'skills/implement/prompt.md' }],
    );

    await dispatchCoachCandidates({
      projectId: 'p',
      playbookId: 2,
      manifest,
      lifecycleCount: 5,
      lifecycleIds: [1, 2, 3, 4, 5],
      coachPolicy: { enabled: true, consistencyThreshold: 0.8, minLifecycles: 3 },
      coachWorkflowRunner: mockCoachRunner,
    });

    expect(mockCoachRunner).not.toHaveBeenCalled();
  });

  it('does not fire when lifecycleCount is below minLifecycles', async () => {
    const mockCoachRunner = vi.fn();
    const manifest = makeManifestWithCandidates(
      [{ patternId: 'PLAN::developer', consistencyScore: 0.95 }],
      [{ kind: 'skill-prompt', targetPath: 'skills/implement/prompt.md' }],
    );

    await dispatchCoachCandidates({
      projectId: 'p',
      playbookId: 3,
      manifest,
      lifecycleCount: 2,
      lifecycleIds: [1, 2],
      coachPolicy: { enabled: true, consistencyThreshold: 0.8, minLifecycles: 3 },
      coachWorkflowRunner: mockCoachRunner,
    });

    expect(mockCoachRunner).not.toHaveBeenCalled();
  });

  it('skips forbidden targets and emits coach.skipped-forbidden-target', async () => {
    const mockCoachRunner = vi.fn();
    const manifest = makeManifestWithCandidates(
      [{ patternId: 'VERDICT::qa', consistencyScore: 0.9 }],
      [{ kind: 'skill-prompt', targetPath: 'skills/qa/prompt.md' }],
    );

    await dispatchCoachCandidates({
      projectId: 'p',
      playbookId: 4,
      manifest,
      lifecycleCount: 5,
      lifecycleIds: [1, 2, 3, 4, 5],
      coachPolicy: { enabled: true, consistencyThreshold: 0.8, minLifecycles: 3 },
      coachWorkflowRunner: mockCoachRunner,
    });

    expect(mockCoachRunner).not.toHaveBeenCalled();
    const events = mockAppendEvent.mock.calls.map((c) => c[0]);
    expect(events.some((e) => e.kind === 'coach.skipped-forbidden-target')).toBe(true);
  });

  it('dispatches once per each matching candidate when multiple pass filters', async () => {
    const mockCoachRunner = vi.fn().mockResolvedValue({ ok: true });
    const manifest = makeManifestWithCandidates(
      [{ patternId: 'PLAN::developer', consistencyScore: 0.9 }],
      [
        { kind: 'skill-prompt', targetPath: 'skills/implement/prompt.md' },
        { kind: 'skill-schema', targetPath: 'skills/triage/schema.ts' },
      ],
    );

    await dispatchCoachCandidates({
      projectId: 'p',
      playbookId: 5,
      manifest,
      lifecycleCount: 4,
      lifecycleIds: [1, 2, 3, 4],
      coachPolicy: { enabled: true, consistencyThreshold: 0.8, minLifecycles: 3 },
      coachWorkflowRunner: mockCoachRunner,
    });

    expect(mockCoachRunner).toHaveBeenCalledTimes(2);
    const targets = mockCoachRunner.mock.calls.map(
      (c) => (c[0] as { targetSkillName: string }).targetSkillName,
    );
    expect(targets).toContain('implement');
    expect(targets).toContain('triage');
  });
});
