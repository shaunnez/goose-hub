import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventStore = {
  replay: vi.fn(),
  appendEvent: vi.fn(),
};

const mockPersist = vi.fn();
const mockListTrend = vi.fn();
const mockGetByPipeline = vi.fn();

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: mockEventStore,
}));

vi.mock('@goose-hub/core/quality-score/repository.js', () => ({
  persistRunQualityScore: mockPersist,
  listProjectQualityTrend: mockListTrend,
  getLatestQualityScoreByPipelineRun: mockGetByPipeline,
}));

const { runMergeDecision } = await import('./workflow.js');

interface QaPayload {
  pipelineRunId?: string;
  tierResults?: Record<
    'structural' | 'functional' | 'regression',
    {
      passed?: boolean;
      findings?: Array<{ severity?: string; priority?: string }>;
    }
  >;
  testRun?: { total?: number; passed?: number };
}

interface ReviewPayload {
  pipelineRunId?: string;
  verdict?: string;
  findings?: Array<{ severity?: string; priority?: string }>;
}

function qaEvent(payload: QaPayload) {
  return {
    id: 1,
    kind: 'qa.completed',
    projectId: 'p',
    workItemId: 'wi-1',
    payload,
    runId: 'qa-run',
    personaId: null,
    createdAt: '2026-05-11T00:00:00Z',
  };
}

function reviewEvent(payload: ReviewPayload) {
  return {
    id: 2,
    kind: 'review.completed',
    projectId: 'p',
    workItemId: 'wi-1',
    payload,
    runId: 'rev-run',
    personaId: null,
    createdAt: '2026-05-11T00:00:01Z',
  };
}

function trendRow(score: number, pipelineRunId: string, ts = '2026-05-10T00:00:00Z') {
  return {
    runId: pipelineRunId,
    pipelineRunId,
    projectId: 'p',
    iteration: 0,
    score,
    components: {
      p0_count: 0,
      p1_count: 0,
      p2_count: 0,
      p3_count: 0,
      regressions_open: 0,
      review_converged: true,
      uat_passed: true,
      static_passed: true,
      harness_pass_rate: 1.0,
    },
    auditScore: null,
    ts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runMergeDecision — warmup score-only gate (prior < 3)', () => {
  it('passes when score >= 80 and no prior runs exist', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-1',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [] },
          regression: { passed: true, findings: [] },
        },
        testRun: { total: 100, passed: 100 },
      }),
      reviewEvent({ pipelineRunId: 'pipe-1', verdict: 'approved', findings: [] }),
    ]);
    mockListTrend.mockReturnValue([]);

    const result = runMergeDecision({
      pipelineRunId: 'pipe-1',
      projectId: 'p',
      workItemId: 'wi-1',
    });

    expect(result.passed).toBe(true);
    expect(result.reason).toBe('score-only-pass');
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(mockPersist).toHaveBeenCalledOnce();
  });

  it('blocks when score < 80 and prior runs are insufficient', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-2',
        tierResults: {
          structural: { passed: false, findings: [] },
          functional: { passed: false, findings: [] },
          regression: { passed: false, findings: [] },
        },
      }),
    ]);
    mockListTrend.mockReturnValue([]);

    const result = runMergeDecision({
      pipelineRunId: 'pipe-2',
      projectId: 'p',
      workItemId: 'wi-1',
    });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBe('score-below-threshold');
    }
  });
});

describe('runMergeDecision — score+convergence gate (prior >= 3)', () => {
  it('passes when score >= 80 AND last-3 scores converge with p0+p1 = 0', () => {
    // Current run: perfect — score = 20 base + 30 harness + 20 + 20 + 10 = 100.
    // Convergence window with priors [92, 93] → [92, 93, 100] delta 8 → would
    // NOT converge. So tune the harness to land closer: total=10/passed=9 gives
    // harness=0.9 → contribution 27 → total 97. Delta from priors still high.
    // Use priors [96, 97] and current 100 → delta 4 < 5 → converged.
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-current',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [] },
          regression: { passed: true, findings: [] },
        },
        testRun: { total: 100, passed: 100 },
      }),
      reviewEvent({ pipelineRunId: 'pipe-current', verdict: 'approved', findings: [] }),
    ]);
    mockListTrend.mockReturnValue([
      trendRow(85, 'pipe-a'),
      trendRow(96, 'pipe-b'),
      trendRow(97, 'pipe-c'),
    ]);

    const result = runMergeDecision({
      pipelineRunId: 'pipe-current',
      projectId: 'p',
      workItemId: 'wi-1',
    });

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.reason).toBe('score-plus-convergence-pass');
    }
  });

  it('blocks not-converged when delta across last 3 scores >= 5', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-current',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [] },
          regression: { passed: true, findings: [] },
        },
        testRun: { total: 10, passed: 8 },
      }),
      reviewEvent({ pipelineRunId: 'pipe-current', verdict: 'approved', findings: [] }),
    ]);
    // Last-2 priors plus current would be [70, 82, 86] → delta 16 → not converged.
    mockListTrend.mockReturnValue([
      trendRow(70, 'pipe-a'),
      trendRow(70, 'pipe-b'),
      trendRow(82, 'pipe-c'),
    ]);

    const result = runMergeDecision({
      pipelineRunId: 'pipe-current',
      projectId: 'p',
      workItemId: 'wi-1',
    });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBe('not-converged');
    }
  });

  it('blocks score-below-threshold even with prior >= 3', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-low',
        tierResults: {
          structural: { passed: false, findings: [] },
          functional: { passed: false, findings: [] },
          regression: { passed: false, findings: [] },
        },
      }),
    ]);
    mockListTrend.mockReturnValue([
      trendRow(82, 'pipe-a'),
      trendRow(83, 'pipe-b'),
      trendRow(84, 'pipe-c'),
    ]);

    const result = runMergeDecision({
      pipelineRunId: 'pipe-low',
      projectId: 'p',
      workItemId: 'wi-1',
    });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBe('score-below-threshold');
    }
  });
});

describe('runMergeDecision — P0 zeroes the score', () => {
  it('blocks merge when any QA finding has priority P0', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-p0',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [{ severity: 'error', priority: 'P0' }] },
          regression: { passed: true, findings: [] },
        },
        testRun: { total: 100, passed: 100 },
      }),
    ]);
    mockListTrend.mockReturnValue([]);

    const result = runMergeDecision({
      pipelineRunId: 'pipe-p0',
      projectId: 'p',
      workItemId: 'wi-1',
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });
});
