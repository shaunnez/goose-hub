import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import config from './config.js';
import { DeepRetroSchema } from './schema.js';

const ISO = '2026-05-03T12:00:00.000Z';

const baseValid = {
  summary:
    '- Implemented vertical slice cleanly.\n- No holdout violations.\n- Zero retry attempts.',
  personaAnalysis: [
    {
      personaName: 'alice',
      role: 'developer',
      skillName: 'implement',
      score: 0.9,
      trend: 'improving',
      sampleCount: 4,
      computedAt: ISO,
    },
  ],
  learningEntries: [
    {
      id: 'le-001',
      sourceRunIds: ['run-abc'],
      personaName: 'alice',
      role: 'developer',
      observation: 'Slice pattern consistently reduces integration surface',
      rationale: 'No cross-slice imports in last 4 runs',
      improvementKind: 'skill-prompt',
      confidence: 'medium',
    },
  ],
  decisionPatterns: [
    {
      id: 'dp-001',
      pattern: 'Developer writes tests before any implementation',
      frequency: 4,
      confidence: 'high',
      exampleRunIds: ['run-abc', 'run-def'],
      surfacedAt: ISO,
    },
  ],
  improvementCandidates: [
    {
      kind: 'skill-prompt',
      targetPath: 'skills/implement/prompt.md',
      sourceRunId: 'run-abc',
      sourceProject: 'goose-hub',
      sourceWorkItem: 'shaunnez/goose-hub#77',
      suggestionText: 'Add explicit reminder to write slice.test.ts first',
      confidence: 'high',
    },
  ],
  decisionSummaries: [
    { step: 'tier-select', summary: 'Selected light retro — no deep triggers fired' },
  ],
};

describe('DeepRetroSchema', () => {
  it('accepts a fully-populated valid deep retro output', () => {
    expect(DeepRetroSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts empty arrays for personaAnalysis, learningEntries, decisionPatterns, improvementCandidates', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        personaAnalysis: [],
        learningEntries: [],
        decisionPatterns: [],
        improvementCandidates: [],
      }).success,
    ).toBe(true);
  });

  it('accepts optional proposedDiff on improvementCandidates', () => {
    const withDiff = {
      ...baseValid,
      improvementCandidates: [
        { ...baseValid.improvementCandidates[0], proposedDiff: '- old line\n+ new line' },
      ],
    };
    expect(DeepRetroSchema.safeParse(withDiff).success).toBe(true);
  });

  it('rejects empty summary', () => {
    expect(DeepRetroSchema.safeParse({ ...baseValid, summary: '' }).success).toBe(false);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    expect(DeepRetroSchema.safeParse({ ...baseValid, decisionSummaries: [] }).success).toBe(false);
  });

  it('rejects invalid QualityScore score above 1', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        personaAnalysis: [{ ...baseValid.personaAnalysis[0], score: 2.0 }],
      }).success,
    ).toBe(false);
  });

  it('rejects invalid LearningEntry with empty sourceRunIds', () => {
    expect(
      DeepRetroSchema.safeParse({
        ...baseValid,
        learningEntries: [{ ...baseValid.learningEntries[0], sourceRunIds: [] }],
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
