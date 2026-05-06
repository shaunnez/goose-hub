import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => {
  const FLUENT = ['select', 'from', 'where'] as const;
  const mockDb: Record<string, unknown> = {};
  for (const method of FLUENT) {
    mockDb[method] = vi.fn().mockReturnValue(mockDb);
  }
  mockDb.all = vi.fn().mockReturnValue([]);
  return { mockDb: mockDb as Record<string, ReturnType<typeof vi.fn>> };
});

vi.mock('../db/db.js', () => ({ db: mockDb }));
vi.mock('../db/schema.js', () => ({
  archivedLifecycles: {
    projectId: 'project_id',
    closedAt: 'closed_at',
  },
  events: {
    projectId: 'project_id',
    createdAt: 'created_at',
  },
  agentRunCosts: {
    projectId: 'project_id',
    createdAt: 'created_at',
    stage: 'stage',
    skill: 'skill',
    costUsd: 'cost_usd',
  },
}));

function reset() {
  vi.clearAllMocks();
  mockDb.select = vi.fn().mockReturnValue(mockDb);
  mockDb.from = vi.fn().mockReturnValue(mockDb);
  mockDb.where = vi.fn().mockReturnValue(mockDb);
  mockDb.all = vi.fn().mockReturnValue([]);
}

import {
  computeCostBaselines,
  computeGateThresholds,
  computePercentile,
  computeStats,
} from './playbook-stats.js';

describe('computeStats', () => {
  it('returns zeros for empty array', () => {
    expect(computeStats([])).toEqual({ mean: 0, min: 0, max: 0, stdDev: 0, sampleCount: 0 });
  });

  it('handles single sample (stdDev = 0)', () => {
    expect(computeStats([42])).toEqual({
      mean: 42,
      min: 42,
      max: 42,
      stdDev: 0,
      sampleCount: 1,
    });
  });

  it('computes mean / min / max / stdDev for multi-sample', () => {
    const result = computeStats([60, 70, 80, 90, 100]);
    expect(result.mean).toBe(80);
    expect(result.min).toBe(60);
    expect(result.max).toBe(100);
    expect(result.sampleCount).toBe(5);
    // population stdDev of [60,70,80,90,100] = sqrt(200) ≈ 14.142
    expect(result.stdDev).toBeCloseTo(Math.sqrt(200), 5);
  });

  it('handles all-zero samples', () => {
    expect(computeStats([0, 0, 0])).toEqual({
      mean: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      sampleCount: 3,
    });
  });
});

describe('computePercentile', () => {
  it('returns 0 for empty array', () => {
    expect(computePercentile([], 0.5)).toBe(0);
  });

  it('returns the only sample for size 1', () => {
    expect(computePercentile([7], 0.95)).toBe(7);
  });

  it('p50 of [1,2,3,4,5] = 3', () => {
    expect(computePercentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('p95 of 20 samples is at the high end', () => {
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    const p95 = computePercentile(samples, 0.95);
    expect(p95).toBeGreaterThanOrEqual(samples[18]);
    expect(p95).toBeLessThanOrEqual(samples[19]);
  });

  it('handles unsorted input by sorting internally', () => {
    expect(computePercentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
  });
});

describe('computeGateThresholds', () => {
  beforeEach(reset);

  it('returns zeroed entries for both gates when no events match', () => {
    mockDb.all = vi.fn().mockReturnValue([]);
    const result = computeGateThresholds({
      projectId: 'p',
      windowStartAt: '2026-04-01T00:00:00Z',
      windowEndAt: '2026-05-01T00:00:00Z',
    });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.gate)).toEqual(['qa', 'review']);
    expect(result[0].sampleCount).toBe(0);
  });

  it('aggregates qa overallScore and review confidence into per-gate stats', () => {
    mockDb.all = vi.fn().mockReturnValue([
      { kind: 'qa.completed', payload: JSON.stringify({ overallScore: 70 }) },
      { kind: 'qa.completed', payload: JSON.stringify({ overallScore: 80 }) },
      { kind: 'qa.completed', payload: JSON.stringify({ overallScore: 90 }) },
      { kind: 'review.completed', payload: JSON.stringify({ confidence: 0.8 }) },
      { kind: 'review.completed', payload: JSON.stringify({ confidence: 0.9 }) },
      { kind: 'agent.run-completed', payload: JSON.stringify({ ok: true }) }, // ignored
    ]);
    const result = computeGateThresholds({
      projectId: 'p',
      windowStartAt: '2026-04-01T00:00:00Z',
      windowEndAt: '2026-05-01T00:00:00Z',
    });
    const qa = result.find((r) => r.gate === 'qa');
    const review = result.find((r) => r.gate === 'review');
    expect(qa?.mean).toBe(80);
    expect(qa?.min).toBe(70);
    expect(qa?.max).toBe(90);
    expect(qa?.sampleCount).toBe(3);
    expect(review?.mean).toBeCloseTo(0.85, 5);
    expect(review?.sampleCount).toBe(2);
  });

  it('tolerates malformed payloads without crashing', () => {
    mockDb.all = vi.fn().mockReturnValue([
      { kind: 'qa.completed', payload: 'not-json' },
      { kind: 'qa.completed', payload: JSON.stringify({}) },
      { kind: 'qa.completed', payload: JSON.stringify({ overallScore: 60 }) },
    ]);
    const result = computeGateThresholds({
      projectId: 'p',
      windowStartAt: '2026-04-01T00:00:00Z',
      windowEndAt: '2026-05-01T00:00:00Z',
    });
    const qa = result.find((r) => r.gate === 'qa');
    expect(qa?.sampleCount).toBe(1);
    expect(qa?.mean).toBe(60);
  });
});

describe('computeCostBaselines', () => {
  beforeEach(reset);

  it('returns empty array when no costs match', () => {
    mockDb.all = vi.fn().mockReturnValue([]);
    expect(
      computeCostBaselines({
        projectId: 'p',
        windowStartAt: '2026-04-01T00:00:00Z',
        windowEndAt: '2026-05-01T00:00:00Z',
      }),
    ).toEqual([]);
  });

  it('groups by (role, skill) and computes mean / p50 / p95', () => {
    mockDb.all = vi.fn().mockReturnValue([
      { stage: 'developer', skill: 'implement', costUsd: 0.1 },
      { stage: 'developer', skill: 'implement', costUsd: 0.2 },
      { stage: 'developer', skill: 'implement', costUsd: 0.3 },
      { stage: 'developer', skill: 'implement', costUsd: 0.4 },
      { stage: 'developer', skill: 'implement', costUsd: 0.5 },
      { stage: 'qa', skill: 'qa', costUsd: 1.0 },
    ]);
    const result = computeCostBaselines({
      projectId: 'p',
      windowStartAt: '2026-04-01T00:00:00Z',
      windowEndAt: '2026-05-01T00:00:00Z',
    });
    expect(result).toHaveLength(2);
    const dev = result.find((r) => r.role === 'developer' && r.skill === 'implement');
    const qa = result.find((r) => r.role === 'qa' && r.skill === 'qa');
    expect(dev?.mean).toBeCloseTo(0.3, 5);
    expect(dev?.p50).toBeCloseTo(0.3, 5);
    expect(dev?.p95).toBeCloseTo(0.48, 2);
    expect(dev?.sampleCount).toBe(5);
    expect(qa?.mean).toBe(1.0);
    expect(qa?.sampleCount).toBe(1);
  });

  it('produces deterministic ordering by role+skill', () => {
    mockDb.all = vi.fn().mockReturnValue([
      { stage: 'qa', skill: 'qa', costUsd: 1.0 },
      { stage: 'developer', skill: 'implement', costUsd: 0.1 },
      { stage: 'reviewer', skill: 'review', costUsd: 0.05 },
    ]);
    const result = computeCostBaselines({
      projectId: 'p',
      windowStartAt: '2026-04-01T00:00:00Z',
      windowEndAt: '2026-05-01T00:00:00Z',
    });
    expect(result.map((r) => `${r.role}::${r.skill}`)).toEqual([
      'developer::implement',
      'qa::qa',
      'reviewer::review',
    ]);
  });
});
