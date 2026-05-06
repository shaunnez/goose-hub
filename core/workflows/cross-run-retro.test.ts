import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCrossRunRetroWorkflow } from './cross-run-retro.js';

// ─── module mocks ─────────────────────────────────────────────────────────────

const mockRun = vi.fn();

vi.mock('../agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('../agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('../agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'test-project/retrospector/0', codename: 'Grey Honker' }),
}));

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'playbook.created', payload: {}, createdAt: '' }),
    replay: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../persona/accumulate.js', () => ({
  accumulatePersonaStats: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock skill prompt') };
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeCrossRunRetroResult() {
  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date().toISOString();
  return {
    output: {
      outcome: 'success',
      workItemNumber: 0,
      windowStartAt: windowStart,
      windowEndAt: windowEnd,
      lifecycleCount: 3,
      summary: {
        wentWell: 'Patterns converged',
        didNotGoWell: 'High initial cost',
        architecturalTakeaway: 'Vertical slices work well',
      },
      aggregatedLearnings: [
        {
          observation: 'TDD reduces rework',
          occurrenceCount: 5,
          confidence: 'high',
          firstSeen: windowStart,
          lastSeen: windowEnd,
        },
      ],
      topPatterns: [
        {
          pattern: 'Prefer vertical slice',
          occurrences: 7,
          consistency: 0.95,
          confidence: 'high',
          consistencyScore: 0.95,
          occurrenceCount: 7,
        },
      ],
      gateThresholds: [
        {
          gate: 'qa',
          meanScore: 0.85,
          minScore: 0.7,
          maxScore: 0.95,
          sampleCount: 10,
        },
      ],
      costBaselines: [
        {
          role: 'developer',
          skill: 'implement',
          meanCost: 0.25,
          p50Cost: 0.2,
          p95Cost: 0.45,
          sampleCount: 8,
        },
      ],
      improvementCandidates: [],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Analysis complete' }],
    },
    decisionSummaries: [],
    events: [],
  };
}

describe('runCrossRunRetroWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs happy path: accepts window config and dispatches skill', async () => {
    mockRun.mockResolvedValueOnce(makeCrossRunRetroResult());

    const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date();

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowDateRange: {
        startAt: windowStart.toISOString(),
        endAt: windowEnd.toISOString(),
      },
    });

    expect(mockRun).toHaveBeenCalledOnce();
    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('retrospective-cross-run');
    expect(callArgs.role).toBe('retrospector');
    expect(callArgs.context.projectId).toBe('test-project');
  });

  it('handles windowSize config (7 days back)', async () => {
    mockRun.mockResolvedValueOnce(makeCrossRunRetroResult());

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'week',
    });

    expect(mockRun).toHaveBeenCalledOnce();
    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.context.windowStartAt).toBeDefined();
    expect(callArgs.context.windowEndAt).toBeDefined();
  });

  it('emits events for workflow lifecycle', async () => {
    mockRun.mockResolvedValueOnce(makeCrossRunRetroResult());
    const { eventStore } = await import('../event-stream/store.js');

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'week',
    });

    // Verify events are appended
    expect(eventStore.appendEvent).toHaveBeenCalled();
    const calls = (eventStore.appendEvent as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(
      calls.some((c: unknown[]) => (c[0] as Record<string, string>).kind === 'agent.run-started'),
    ).toBe(true);
    expect(
      calls.some((c: unknown[]) => (c[0] as Record<string, string>).kind === 'playbook.created'),
    ).toBe(true);
  });

  it('handles empty archive gracefully', async () => {
    const emptyResult = makeCrossRunRetroResult();
    emptyResult.output.lifecycleCount = 0;
    emptyResult.output.aggregatedLearnings = [];
    emptyResult.output.topPatterns = [];

    mockRun.mockResolvedValueOnce(emptyResult);

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'week',
    });

    expect(mockRun).toHaveBeenCalledOnce();
  });

  it('computes gate thresholds from historical data', async () => {
    mockRun.mockResolvedValueOnce(makeCrossRunRetroResult());

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'week',
    });

    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.context.historicalGateScores).toBeDefined();
    expect(Array.isArray(callArgs.context.historicalGateScores)).toBe(true);
  });

  it('computes cost baselines from historical data', async () => {
    mockRun.mockResolvedValueOnce(makeCrossRunRetroResult());

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'week',
    });

    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.context.historicalCosts).toBeDefined();
    expect(Array.isArray(callArgs.context.historicalCosts)).toBe(true);
  });

  it('validates output against schema before persisting', async () => {
    const invalidResult = makeCrossRunRetroResult();
    invalidResult.output.lifecycleCount = -1; // Invalid

    mockRun.mockResolvedValueOnce(invalidResult);

    const { eventStore } = await import('../event-stream/store.js');

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'week',
    });

    // Should emit failure event
    const appendEventMock = eventStore.appendEvent as unknown as { mock: { calls: unknown[][] } };
    const failureEmitted = appendEventMock.mock.calls.some(
      (c: unknown[]) => (c[0] as Record<string, string>).kind === 'agent.run-failed',
    );
    expect(failureEmitted).toBe(true);
  });

  it('handles window edge case: single lifecycle', async () => {
    const singleLifecycleResult = makeCrossRunRetroResult();
    singleLifecycleResult.output.lifecycleCount = 1;

    mockRun.mockResolvedValueOnce(singleLifecycleResult);

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'day',
    });

    expect(mockRun).toHaveBeenCalledOnce();
  });

  it('handles parsing failures gracefully', async () => {
    mockRun.mockResolvedValueOnce({ output: { invalid: 'schema' } });
    const { eventStore } = await import('../event-stream/store.js');

    await runCrossRunRetroWorkflow({
      projectId: 'test-project',
      windowSize: 'week',
    });

    const appendEventMock = eventStore.appendEvent as unknown as { mock: { calls: unknown[][] } };
    const failureEmitted = appendEventMock.mock.calls.some(
      (c: unknown[]) => (c[0] as Record<string, string>).kind === 'agent.run-failed',
    );
    expect(failureEmitted).toBe(true);
  });
});
