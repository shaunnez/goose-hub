import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { DeepRetroSchema } from './schema.js';
import config from './skill.config.js';

const baseValid = {
  outcome: 'success' as const,
  workItemNumber: 77,
  triggerReasons: ['standard-deep'],
  summary: {
    wentWell: 'Implemented vertical slice cleanly',
    didNotGoWell: 'No holdout violations',
    architecturalTakeaway: 'Zero retry attempts; TDD discipline held',
  },
  personaQualityScores: [
    {
      personaId: 'goose-hub-self/developer/0',
      score: 0.9,
      trend: 'improving' as const,
      sampleCount: 4,
      rationale: 'TDD held across all 5 ACs; one minor lint warning auto-fixed.',
    },
  ],
  learningEntries: [
    {
      observation: 'Slice pattern consistently reduces integration surface',
      rationale: 'No cross-slice imports in last 4 runs',
      improvementKind: 'skill-prompt' as const,
      confidence: 'medium' as const,
    },
  ],
  decisionPatterns: [
    {
      pattern: 'Developer writes tests before any implementation',
      occurrences: 4,
      confidence: 'high' as const,
    },
  ],
  improvementCandidates: [
    {
      kind: 'skill-prompt' as const,
      targetPath: 'skills/implement/prompt.md',
      suggestionText: 'Add explicit reminder to write slice.test.ts first',
      confidence: 'high' as const,
    },
  ],
  decisionSummaries: [
    { kind: 'PLAN' as const, summary: 'Selected deep retro — first-run trigger' },
  ],
};

describe('DeepRetroSchema', () => {
  it('accepts a fully-populated valid deep retro output', () => {
    expect(DeepRetroSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts empty arrays for personaQualityScores, learningEntries, decisionPatterns, improvementCandidates', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        personaQualityScores: [],
        learningEntries: [],
        decisionPatterns: [],
        improvementCandidates: [],
      }).success,
    ).toBe(true);
  });

  it('accepts optional proposedDiff and evidence on improvementCandidates', () => {
    const withExtras = {
      ...baseValid,
      improvementCandidates: [
        {
          ...baseValid.improvementCandidates[0],
          proposedDiff: '- old line\n+ new line',
          evidence: 'Cited by 3 reviewers',
        },
      ],
    };
    expect(DeepRetroSchema.safeParse(withExtras).success).toBe(true);
  });

  it('accepts optional note on decisionPatterns', () => {
    const withNote = {
      ...baseValid,
      decisionPatterns: [{ ...baseValid.decisionPatterns[0], note: 'cross-run evidence' }],
    };
    expect(DeepRetroSchema.safeParse(withNote).success).toBe(true);
  });

  it('rejects empty summary field', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        summary: { ...baseValid.summary, wentWell: '' },
      }).success,
    ).toBe(false);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    expect(DeepRetroSchema.safeParse({ ...baseValid, decisionSummaries: [] }).success).toBe(false);
  });

  it('rejects invalid QualityScore score above 1', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        personaQualityScores: [{ ...baseValid.personaQualityScores[0], score: 2.0 }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown improvementCandidate kind', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        improvementCandidates: [{ ...baseValid.improvementCandidates[0], kind: 'unknown' }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown confidence on improvementCandidate', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        improvementCandidates: [{ ...baseValid.improvementCandidates[0], confidence: 'very-high' }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown improvementKind on learningEntry', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        learningEntries: [{ ...baseValid.learningEntries[0], improvementKind: 'scope-discipline' }],
      }).success,
    ).toBe(false);
  });

  it('rejects invalid outcome', () => {
    expect(DeepRetroSchema.safeParse({ ...baseValid, outcome: 'unknown' }).success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces a valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(DeepRetroSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
  });
});

describe('retrospective-deep skill config', () => {
  it('has role retrospector', () => {
    expect(config.role).toBe('retrospector');
  });

  it('is pinned to sonnet (deep retro is structured analysis, not coding)', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('is not a holdout (retrospector sees run history and decision summaries)', () => {
    expect(config.freshContext).toBe(false);
  });
});
