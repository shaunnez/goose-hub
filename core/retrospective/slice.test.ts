import { describe, expect, it } from 'vitest';
import {
  CONVERGENCE_THRESHOLD,
  DecisionPatternSchema,
  ImprovementKindSchema,
  LearningEntrySchema,
  QualityScoreSchema,
  SummarySchema,
} from './schemas.js';

describe('SummarySchema', () => {
  const base = {
    wentWell: 'Tests passed first try',
    didNotGoWell: 'One lint warning auto-fixed',
    architecturalTakeaway: 'Vertical slice pattern reduces conflicts',
  };

  it('accepts a fully-populated summary', () => {
    expect(SummarySchema.safeParse(base).success).toBe(true);
  });

  it('rejects empty wentWell', () => {
    expect(SummarySchema.safeParse({ ...base, wentWell: '' }).success).toBe(false);
  });

  it('rejects missing didNotGoWell', () => {
    const { didNotGoWell: _omit, ...rest } = base;
    expect(SummarySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing architecturalTakeaway', () => {
    const { architecturalTakeaway: _omit, ...rest } = base;
    expect(SummarySchema.safeParse(rest).success).toBe(false);
  });
});

describe('LearningEntrySchema', () => {
  const base = {
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

  it('rejects empty observation', () => {
    expect(LearningEntrySchema.safeParse({ ...base, observation: '' }).success).toBe(false);
  });

  it('rejects missing rationale', () => {
    const { rationale: _omit, ...rest } = base;
    expect(LearningEntrySchema.safeParse(rest).success).toBe(false);
  });
});

describe('QualityScoreSchema', () => {
  const base = {
    personaId: 'goose-hub-self/developer/0',
    score: 0.85,
    trend: 'improving' as const,
    sampleCount: 5,
    rationale: 'Wrote tests red-green-refactor across all 5 acceptance criteria with zero retries.',
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

  it('rejects empty rationale', () => {
    expect(QualityScoreSchema.safeParse({ ...base, rationale: '' }).success).toBe(false);
  });

  it('rejects missing rationale', () => {
    const { rationale: _omit, ...rest } = base;
    expect(QualityScoreSchema.safeParse(rest).success).toBe(false);
  });
});

describe('DecisionPatternSchema', () => {
  const base = {
    pattern: 'Developer consistently chooses vertical slice before horizontal',
    occurrences: 7,
    confidence: 'high' as const,
  };

  it('accepts a fully-populated valid pattern', () => {
    expect(DecisionPatternSchema.safeParse(base).success).toBe(true);
  });

  it('accepts optional note when present', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, note: 'cross-run evidence' }).success).toBe(
      true,
    );
  });

  it('rejects occurrences less than 1', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, occurrences: 0 }).success).toBe(false);
  });

  it('rejects non-integer occurrences', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, occurrences: 1.5 }).success).toBe(false);
  });

  it('rejects empty pattern', () => {
    expect(DecisionPatternSchema.safeParse({ ...base, pattern: '' }).success).toBe(false);
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
