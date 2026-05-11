import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventStore = {
  replay: vi.fn(),
};

vi.mock('../event-stream/store.js', () => ({
  eventStore: mockEventStore,
}));

const { buildRunArtifacts } = await import('./build-artifacts.js');

function qaEvent(payload: Record<string, unknown>) {
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

function reviewEvent(payload: Record<string, unknown>) {
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRunArtifacts — filters by pipelineRunId across multiple runIds', () => {
  it('matches events whose payload.pipelineRunId equals the target', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-target',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [{ severity: 'warning' }] },
          regression: { passed: true, findings: [] },
        },
        testRun: { total: 50, passed: 50 },
      }),
      // Different pipeline — must be ignored
      qaEvent({
        pipelineRunId: 'pipe-other',
        tierResults: {
          structural: { passed: false, findings: [{ severity: 'error', priority: 'P0' }] },
          functional: { passed: false, findings: [] },
          regression: { passed: false, findings: [] },
        },
      }),
      reviewEvent({
        pipelineRunId: 'pipe-target',
        verdict: 'approved',
        findings: [{ severity: 'minor' }],
      }),
    ]);

    const result = buildRunArtifacts('pipe-target', {
      projectId: 'p',
      workItemId: 'wi-1',
    });

    expect(result.pipelineRunId).toBe('pipe-target');
    expect(result.components.p0_count).toBe(0); // pipe-other's P0 must not bleed in
    expect(result.components.review_converged).toBe(true);
    expect(result.components.static_passed).toBe(true);
    expect(result.components.uat_passed).toBe(true);
    expect(result.components.harness_pass_rate).toBe(1);
  });
});

describe('buildRunArtifacts — priority counting', () => {
  it('counts QA findings using explicit priority when provided', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-1',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: {
            passed: true,
            findings: [
              { severity: 'error', priority: 'P0' },
              { severity: 'error', priority: 'P1' },
              { severity: 'warning' }, // → default P2
              { severity: 'info' }, // → default P3
            ],
          },
          regression: { passed: true, findings: [] },
        },
      }),
    ]);

    const result = buildRunArtifacts('pipe-1', { projectId: 'p' });
    expect(result.components.p0_count).toBe(1);
    expect(result.components.p1_count).toBe(1);
    expect(result.components.p2_count).toBe(1);
    expect(result.components.p3_count).toBe(1);
  });

  it('uses defaultReviewPriority when review findings omit priority', () => {
    mockEventStore.replay.mockReturnValue([
      reviewEvent({
        pipelineRunId: 'pipe-1',
        verdict: 'needs-fix',
        findings: [
          { severity: 'blocker' }, // → P0
          { severity: 'major' }, // → P1
          { severity: 'minor' }, // → P2
        ],
      }),
    ]);

    const result = buildRunArtifacts('pipe-1', { projectId: 'p' });
    expect(result.components.p0_count).toBe(1);
    expect(result.components.p1_count).toBe(1);
    expect(result.components.p2_count).toBe(1);
  });

  it('counts regression error-severity findings into regressions_open', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-1',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [] },
          regression: {
            passed: false,
            findings: [
              { severity: 'error', priority: 'P1' },
              { severity: 'error', priority: 'P1' },
              { severity: 'warning' },
            ],
          },
        },
      }),
    ]);

    const result = buildRunArtifacts('pipe-1', { projectId: 'p' });
    expect(result.components.regressions_open).toBe(2);
  });
});

describe('buildRunArtifacts — harness pass rate derivation', () => {
  it('computes from testRun ratio when present', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-1',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [] },
          regression: { passed: true, findings: [] },
        },
        testRun: { total: 10, passed: 8 },
      }),
    ]);

    const result = buildRunArtifacts('pipe-1', { projectId: 'p' });
    expect(result.components.harness_pass_rate).toBeCloseTo(0.8);
  });

  it('falls back to functional.passed when testRun missing', () => {
    mockEventStore.replay.mockReturnValue([
      qaEvent({
        pipelineRunId: 'pipe-1',
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: { passed: true, findings: [] },
          regression: { passed: true, findings: [] },
        },
      }),
    ]);

    const result = buildRunArtifacts('pipe-1', { projectId: 'p' });
    expect(result.components.harness_pass_rate).toBe(1);
  });

  it('returns 0 when no qa.completed events present', () => {
    mockEventStore.replay.mockReturnValue([]);
    const result = buildRunArtifacts('pipe-missing', { projectId: 'p' });
    expect(result.components.harness_pass_rate).toBe(0);
    expect(result.components.static_passed).toBe(false);
    expect(result.components.uat_passed).toBe(false);
    expect(result.components.review_converged).toBe(false);
  });
});

describe('buildRunArtifacts — review_converged', () => {
  it('is true only when latest review.completed verdict is approved', () => {
    mockEventStore.replay.mockReturnValue([
      reviewEvent({ pipelineRunId: 'pipe-1', verdict: 'needs-fix', findings: [] }),
      reviewEvent({ pipelineRunId: 'pipe-1', verdict: 'approved', findings: [] }),
    ]);
    const result = buildRunArtifacts('pipe-1', { projectId: 'p' });
    expect(result.components.review_converged).toBe(true);
  });

  it('is false when latest review verdict is needs-fix', () => {
    mockEventStore.replay.mockReturnValue([
      reviewEvent({ pipelineRunId: 'pipe-1', verdict: 'approved', findings: [] }),
      reviewEvent({ pipelineRunId: 'pipe-1', verdict: 'needs-fix', findings: [] }),
    ]);
    const result = buildRunArtifacts('pipe-1', { projectId: 'p' });
    expect(result.components.review_converged).toBe(false);
  });
});
