import { describe, expect, it, vi } from 'vitest';
import {
  AggregatedLearningSchema,
  CostBaselineSchema,
  CrossRunRetroSchema,
  GateThresholdSchema,
  TopPatternSchema,
} from './schema.js';

describe('CrossRunRetroSchema', () => {
  const now = new Date().toISOString();
  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = now;

  const baseRetro = {
    outcome: 'success' as const,
    workItemNumber: 0,
    windowStartAt: windowStart,
    windowEndAt: windowEnd,
    lifecycleCount: 3,
    summary: {
      wentWell: 'Patterns converged quickly',
      didNotGoWell: 'Initial cost baseline high',
      architecturalTakeaway: 'Vertical slices reduce iterations',
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
        pattern: 'Prefer vertical slice over horizontal',
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
    decisionSummaries: [{ kind: 'VERDICT', summary: 'Cross-run analysis complete' }],
  };

  it('accepts a fully-populated valid cross-run retro', () => {
    expect(CrossRunRetroSchema.safeParse(baseRetro).success).toBe(true);
  });

  it('accepts output with improvement candidates', () => {
    const withCandidates = {
      ...baseRetro,
      improvementCandidates: [
        {
          kind: 'skill-prompt',
          targetPath: 'skills/implement/skill.md',
          suggestionText: 'Clarify scope discipline in prompt',
          confidence: 'high',
          evidence: 'Observed in 3 consecutive pattern miners',
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(withCandidates).success).toBe(true);
  });

  it('rejects invalid gate name', () => {
    const invalid = {
      ...baseRetro,
      gateThresholds: [
        {
          gate: 'invalid-gate',
          meanScore: 0.85,
          minScore: 0.7,
          maxScore: 0.95,
          sampleCount: 10,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects missing window dates', () => {
    const { windowStartAt: _omit1, ...incomplete } = baseRetro;
    expect(CrossRunRetroSchema.safeParse(incomplete).success).toBe(false);
  });

  it('rejects negative lifecycleCount', () => {
    expect(
      CrossRunRetroSchema.safeParse({
        ...baseRetro,
        lifecycleCount: -1,
      }).success,
    ).toBe(false);
  });

  it('accepts zero lifecycleCount (empty archive)', () => {
    expect(
      CrossRunRetroSchema.safeParse({
        ...baseRetro,
        lifecycleCount: 0,
        aggregatedLearnings: [],
        topPatterns: [],
      }).success,
    ).toBe(true);
  });

  it('rejects aggregatedLearning with zero occurrences', () => {
    const invalid = {
      ...baseRetro,
      aggregatedLearnings: [
        {
          observation: 'test',
          occurrenceCount: 0,
          confidence: 'high',
          firstSeen: windowStart,
          lastSeen: windowEnd,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects topPattern with invalid confidence', () => {
    const invalid = {
      ...baseRetro,
      topPatterns: [
        {
          pattern: 'test',
          occurrences: 5,
          consistency: 0.95,
          confidence: 'unknown',
          consistencyScore: 0.95,
          occurrenceCount: 5,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects GateThreshold with invalid score bounds', () => {
    const invalid = {
      ...baseRetro,
      gateThresholds: [
        {
          gate: 'qa',
          meanScore: 1.5,
          minScore: 0.7,
          maxScore: 0.95,
          sampleCount: 10,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects CostBaseline with negative costs', () => {
    const invalid = {
      ...baseRetro,
      costBaselines: [
        {
          role: 'developer',
          skill: 'implement',
          meanCost: -0.25,
          p50Cost: 0.2,
          p95Cost: 0.45,
          sampleCount: 8,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects non-integer sampleCounts', () => {
    const invalid = {
      ...baseRetro,
      gateThresholds: [
        {
          gate: 'qa',
          meanScore: 0.85,
          minScore: 0.7,
          maxScore: 0.95,
          sampleCount: 10.5,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts optional stdDev in gateThreshold', () => {
    const withStdDev = {
      ...baseRetro,
      gateThresholds: [
        {
          gate: 'qa',
          meanScore: 0.85,
          minScore: 0.7,
          maxScore: 0.95,
          stdDev: 0.08,
          sampleCount: 10,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(withStdDev).success).toBe(true);
  });

  it('accepts multiple gates in gateThresholds', () => {
    const multiGate = {
      ...baseRetro,
      gateThresholds: [
        {
          gate: 'qa',
          meanScore: 0.85,
          minScore: 0.7,
          maxScore: 0.95,
          sampleCount: 10,
        },
        {
          gate: 'review',
          meanScore: 0.92,
          minScore: 0.88,
          maxScore: 1.0,
          sampleCount: 10,
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(multiGate).success).toBe(true);
  });

  it('accepts improvement candidate with evidence referencing pattern', () => {
    const withEvidencedCandidate = {
      ...baseRetro,
      improvementCandidates: [
        {
          kind: 'skill-config',
          targetPath: 'skills/implement/config.ts',
          suggestionText: 'Increase budget for deep tier',
          confidence: 'high',
          evidence: 'Pattern "high initial cost" occurred 8 times with rising trend',
        },
      ],
    };
    expect(CrossRunRetroSchema.safeParse(withEvidencedCandidate).success).toBe(true);
  });
});
