import { computeQualityScore, isConverged } from '@goose-hub/core/quality-score/score.js';
import type { QualityComponents, RunArtifacts } from '@goose-hub/core/quality-score/types.js';
import { describe, expect, it } from 'vitest';

function makeComponents(overrides: Partial<QualityComponents> = {}): QualityComponents {
  return {
    p0_count: 0,
    p1_count: 0,
    p2_count: 0,
    p3_count: 0,
    regressions_open: 0,
    review_converged: true,
    uat_passed: true,
    static_passed: true,
    harness_pass_rate: 1.0,
    ...overrides,
  };
}

function makeArtifacts(components: QualityComponents): RunArtifacts {
  return { runId: 'run-1', projectId: 'proj', components };
}

// ─── computeQualityScore ──────────────────────────────────────────────────────

describe('computeQualityScore — P0 zeroes score', () => {
  it('returns 0 when p0_count > 0 regardless of other components', () => {
    const c = makeComponents({ p0_count: 1, harness_pass_rate: 1.0 });
    const { score } = computeQualityScore(makeArtifacts(c));
    expect(score).toBe(0);
  });

  it('returns 0 for multiple P0 findings', () => {
    const c = makeComponents({ p0_count: 3 });
    const { score } = computeQualityScore(makeArtifacts(c));
    expect(score).toBe(0);
  });
});

describe('computeQualityScore — perfect run', () => {
  it('scores 100 when all boolean flags true and harness = 1.0, no findings', () => {
    const c = makeComponents();
    const { score } = computeQualityScore(makeArtifacts(c));
    expect(score).toBe(100);
  });
});

describe('computeQualityScore — finding deductions', () => {
  it('deducts 8 per P1 finding', () => {
    const base = computeQualityScore(makeArtifacts(makeComponents())).score;
    const withP1 = computeQualityScore(makeArtifacts(makeComponents({ p1_count: 1 }))).score;
    expect(base - withP1).toBe(8);
  });

  it('deducts 4 per P2 finding', () => {
    const base = computeQualityScore(makeArtifacts(makeComponents())).score;
    const withP2 = computeQualityScore(makeArtifacts(makeComponents({ p2_count: 1 }))).score;
    expect(base - withP2).toBe(4);
  });

  it('deducts 1 per P3 finding', () => {
    const base = computeQualityScore(makeArtifacts(makeComponents())).score;
    const withP3 = computeQualityScore(makeArtifacts(makeComponents({ p3_count: 1 }))).score;
    expect(base - withP3).toBe(1);
  });

  it('deducts 5 per open regression', () => {
    const base = computeQualityScore(makeArtifacts(makeComponents())).score;
    const withReg = computeQualityScore(
      makeArtifacts(makeComponents({ regressions_open: 1 })),
    ).score;
    expect(base - withReg).toBe(5);
  });
});

describe('computeQualityScore — boolean component penalties', () => {
  it('deducts 20 when uat_passed is false', () => {
    const base = computeQualityScore(makeArtifacts(makeComponents())).score;
    const failing = computeQualityScore(makeArtifacts(makeComponents({ uat_passed: false }))).score;
    expect(base - failing).toBe(20);
  });

  it('deducts 20 when static_passed is false', () => {
    const base = computeQualityScore(makeArtifacts(makeComponents())).score;
    const failing = computeQualityScore(
      makeArtifacts(makeComponents({ static_passed: false })),
    ).score;
    expect(base - failing).toBe(20);
  });

  it('deducts 10 when review_converged is false', () => {
    const base = computeQualityScore(makeArtifacts(makeComponents())).score;
    const failing = computeQualityScore(
      makeArtifacts(makeComponents({ review_converged: false })),
    ).score;
    expect(base - failing).toBe(10);
  });
});

describe('computeQualityScore — harness_pass_rate', () => {
  it('score decreases as harness_pass_rate decreases', () => {
    const full = computeQualityScore(
      makeArtifacts(makeComponents({ harness_pass_rate: 1.0 })),
    ).score;
    const half = computeQualityScore(
      makeArtifacts(makeComponents({ harness_pass_rate: 0.5 })),
    ).score;
    const none = computeQualityScore(
      makeArtifacts(makeComponents({ harness_pass_rate: 0.0 })),
    ).score;
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(none);
  });
});

describe('computeQualityScore — clamping', () => {
  it('never returns a score below 0', () => {
    const c = makeComponents({
      p1_count: 20,
      p2_count: 20,
      regressions_open: 10,
      uat_passed: false,
      static_passed: false,
      review_converged: false,
      harness_pass_rate: 0,
    });
    const { score } = computeQualityScore(makeArtifacts(c));
    expect(score).toBe(0);
  });

  it('never returns a score above 100', () => {
    const { score } = computeQualityScore(makeArtifacts(makeComponents()));
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('computeQualityScore — golden examples from issue spec', () => {
  // run1: harness=0.80, all passing, review_converged=T, p1=1, p2=1, p3=0 → 82
  it('run1 scores 82', () => {
    const c = makeComponents({
      harness_pass_rate: 0.8,
      p1_count: 1,
      p2_count: 1,
    });
    expect(computeQualityScore(makeArtifacts(c)).score).toBe(82);
  });

  // run2: harness=0.80, all passing, review_converged=T, p1=0, p2=2, p3=2 → 84
  it('run2 scores 84', () => {
    const c = makeComponents({
      harness_pass_rate: 0.8,
      p2_count: 2,
      p3_count: 2,
    });
    expect(computeQualityScore(makeArtifacts(c)).score).toBe(84);
  });

  // run3: harness=0.80, all passing, review_converged=T, p1=0, p2=2, p3=1 → 85
  it('run3 scores 85', () => {
    const c = makeComponents({
      harness_pass_rate: 0.8,
      p2_count: 2,
      p3_count: 1,
    });
    expect(computeQualityScore(makeArtifacts(c)).score).toBe(85);
  });
});

// ─── isConverged ─────────────────────────────────────────────────────────────

describe('isConverged — golden examples from issue spec', () => {
  const zeroP = { p0_count: 0, p1_count: 0 };

  it('[82,84,85]: delta=3 < 5, p0+p1=0 → converged', () => {
    expect(isConverged([82, 84, 85], zeroP)).toBe(true);
  });

  it('[78,82,84]: delta=6 ≥ 5 → NOT converged', () => {
    expect(isConverged([78, 82, 84], zeroP)).toBe(false);
  });

  it('[82,84,85] but p1_count=1 → NOT converged', () => {
    expect(isConverged([82, 84, 85], { p0_count: 0, p1_count: 1 })).toBe(false);
  });

  it('[82,84,85] with p0_count=1 → NOT converged', () => {
    expect(isConverged([82, 84, 85], { p0_count: 1, p1_count: 0 })).toBe(false);
  });
});

describe('isConverged — length guard', () => {
  const zeroP = { p0_count: 0, p1_count: 0 };

  it('returns false when fewer than 3 scores', () => {
    expect(isConverged([], zeroP)).toBe(false);
    expect(isConverged([85], zeroP)).toBe(false);
    expect(isConverged([84, 85], zeroP)).toBe(false);
  });

  it('passes with exactly 3 scores that meet the rule', () => {
    expect(isConverged([83, 84, 85], zeroP)).toBe(true);
  });
});

describe('isConverged — uses only last 3 entries from longer history', () => {
  it('ignores older scores outside the last-3 window', () => {
    // First two scores have large delta, last three are tight
    const zeroP = { p0_count: 0, p1_count: 0 };
    expect(isConverged([50, 80, 83, 84, 85], zeroP)).toBe(true);
  });
});

describe('isConverged — exactly 5.0 delta is NOT converged', () => {
  it('delta must be strictly less than 5.0', () => {
    const zeroP = { p0_count: 0, p1_count: 0 };
    expect(isConverged([80, 82, 85], zeroP)).toBe(false); // delta = 5 → NOT converged (not < 5)
    expect(isConverged([81, 82, 85], zeroP)).toBe(true); // delta = 4 < 5 → converged
  });
});

// ─── components passthrough ───────────────────────────────────────────────────

describe('computeQualityScore — components passthrough', () => {
  it('returns the input components unchanged', () => {
    const c = makeComponents({ p2_count: 3 });
    const result = computeQualityScore(makeArtifacts(c));
    expect(result.components).toEqual(c);
  });
});
