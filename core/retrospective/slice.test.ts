import { describe, expect, it } from 'vitest';
import {
  CONVERGENCE_THRESHOLD,
  DecisionPatternSchema,
  ImprovementKindSchema,
  LearningEntrySchema,
  QualityScoreSchema,
} from './schemas.js';

const ISO = '2026-05-03T12:00:00.000Z';

describe('LearningEntrySchema', () => {
  const base = {
    id: 'le-001',
    sourceRunIds: ['run-abc', 'run-def'],
    personaName: 'alice',
    role: 'developer',
    observation: 'Vertical slices reduce merge conflicts',
    rationale: 'Observed in 3 consecutive runs with zero conflicts',
    improvementKind: 'skill-prompt' as const,
    confidence: 'medium' as const,
  };

  it('accepts a fully-populated valid entry', () => {
    expect(LearningEntrySchema.safeParse(base).success).toBe(true);
  });

  it('accepts optional targetPath when present', () => {
    expect(
      LearningEntrySchema.safeParse({ ...base, targetPath: 'skills/implement/prompt.md' }).success,
    ).toBe(true);
  });

  it('accepts all valid ImprovementKind values', () => {
    const kinds = [
      'skill-prompt',
      'skill-schema',
      'skill-config',
      'global-config',
      'project-config',
      'persona',
      'workflow',
      'governance-suggestion',
    ] as const;
    for (const improvementKind of kinds) {
      expect(LearningEntrySchema.safeParse({ ...base, improvementKind }).success).toBe(true);
    }
  });

  it('rejects an unknown improvementKind', () => {
    expect(
      LearningEntrySchema.safeParse({ ...base, improvementKind: 'unknown-kind' }).success,
    ).toBe(false);
  });

  it('rejects empty sourceRunIds array', () => {
    expect(LearningEntrySchema.safeParse({ ...base, sourceRunIds: [] }).success).toBe(false);
  });

  it('rejects missing observation', () => {
    const { observation: _omit, ...rest } = base;
    expect(LearningEntrySchema.safeParse(rest).success).toBe(false);
  });
});

describe('QualityScoreSchema', () => {
  const base = {
    personaName: 'alice',
    role: 'developer',
    skillName: 'implement',
    score: 0.85,
    trend: 'improving' as const,
    sampleCount: 5,
    computedAt: ISO,
  };

  it('accepts a fully-populated valid score', () => {
    expect(QualityScoreSchema.safeParse(base).success).toBe(true);
  });

  it('accepts score at boundary values 0 and 1', () => {
    expect(QualityScoreSchema.safeParse({ ...base, score: 0 }).success).toBe(true);
    expect(QualityScoreSchema.safeParse({ ...base, score: 1 }).success).toBe(true);
  });

  it('rejects score above 1', () => {
    expect(QualityScoreSchema.safeParse({ ...base, score: 1.01 }).success).toBe(false);
  });

  it('rejects score below 0', () => {
    expect(QualityScoreSchema.safeParse({ ...base, score: -0.1 }).success).toBe(false);
  });

  it('rejects non-integer sampleCount', () => {
    expect(QualityScoreSchema.safeParse({ ...base, sampleCount: 2.5 }).success).toBe(false);
  });

  it('rejects sampleCount of zero', () => {
    expect(QualityScoreSchema.safeParse({ ...base, sampleCount: 0 }).success).toBe(false);
  });

  it('accepts all valid trend values', () => {
    for (const trend of ['improving', 'stable', 'declining'] as const) {
      expect(QualityScoreSchema.safeParse({ ...base, trend }).success).toBe(true);
    }
  });

  it('rejects an unknown trend value', () => {
    expect(QualityScoreSchema.safeParse({ ...base, trend: 'flat' }).success).toBe(false);
  });
});

describe('DecisionPatternSchema', () => {
  const base = {
    id: 'dp-001',
    pattern: 'Developer consistently chooses vertical slice before horizontal',
    frequency: 7,
    confidence: 'high' as const,
    exampleRunIds: ['run-abc', 'run-def', 'run-ghi'],
    surfacedAt: ISO,
  };

  it('accepts a fully-populated valid pattern', () => {
    expect(DecisionPatternSchema.safeParse(base).success).toBe(true);
  });

  it('rejects frequency less than 1', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, frequency: 0 }).success).toBe(false);
  });

  it('rejects non-integer frequency', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, frequency: 1.5 }).success).toBe(false);
  });

  it('rejects empty exampleRunIds', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, exampleRunIds: [] }).success).toBe(false);
  });

  it('rejects non-datetime surfacedAt', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, surfacedAt: 'not-a-date' }).success).toBe(
      false,
    );
  });
});

describe('ImprovementKindSchema', () => {
  it('accepts all canonical kinds from CONTEXT.md', () => {
    const kinds = [
      'skill-prompt',
      'skill-schema',
      'skill-config',
      'global-config',
      'project-config',
      'persona',
      'workflow',
      'governance-suggestion',
    ];
    for (const kind of kinds) {
      expect(ImprovementKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(ImprovementKindSchema.safeParse('infrastructure').success).toBe(false);
  });
});

describe('CONVERGENCE_THRESHOLD', () => {
  it('is the string "high" — patterns must reach high confidence to surface', () => {
    expect(CONVERGENCE_THRESHOLD).toBe('high');
  });
});
