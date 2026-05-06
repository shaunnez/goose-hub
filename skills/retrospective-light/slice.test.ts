import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { LightRetroSchema } from './schema.js';
import config from './skill.config.js';

const baseValid = {
  outcome: 'success' as const,
  workItemNumber: 42,
  summary: {
    wentWell: 'Tests all pass',
    didNotGoWell: 'One minor lint warning auto-fixed',
    architecturalTakeaway: 'Dev followed vertical slice pattern throughout',
  },
  improvementCandidates: [
    {
      kind: 'skill-prompt' as const,
      targetPath: 'skills/implement/prompt.md',
      suggestionText: 'Add explicit reminder to check slice.test.ts exists before writing code',
      confidence: 'high' as const,
    },
  ],
  decisionSummaries: [
    { kind: 'PLAN' as const, summary: 'Selected light retro — no deep triggers' },
  ],
};

describe('LightRetroSchema', () => {
  it('accepts a fully-populated valid light retro output', () => {
    expect(LightRetroSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts empty improvementCandidates (common case — clean run)', () => {
    expect(LightRetroSchema.safeParse({ ...baseValid, improvementCandidates: [] }).success).toBe(
      true,
    );
  });

  it('accepts optional proposedDiff on a candidate', () => {
    const withDiff = {
      ...baseValid,
      improvementCandidates: [
        { ...baseValid.improvementCandidates[0], proposedDiff: '- old\n+ new' },
      ],
    };
    expect(LightRetroSchema.safeParse(withDiff).success).toBe(true);
  });

  it('accepts optional evidence on a candidate', () => {
    const withEvidence = {
      ...baseValid,
      improvementCandidates: [
        { ...baseValid.improvementCandidates[0], evidence: 'Reviewer cited gap in 3 runs' },
      ],
    };
    expect(LightRetroSchema.safeParse(withEvidence).success).toBe(true);
  });

  it('rejects empty summary fields', () => {
    expect(
      LightRetroSchema.safeParse({
        ...baseValid,
        summary: { ...baseValid.summary, wentWell: '' },
      }).success,
    ).toBe(false);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    expect(LightRetroSchema.safeParse({ ...baseValid, decisionSummaries: [] }).success).toBe(false);
  });

  it('rejects unknown ImprovementKind on a candidate', () => {
    expect(
      LightRetroSchema.safeParse({
        ...baseValid,
        improvementCandidates: [{ ...baseValid.improvementCandidates[0], kind: 'unknown' }],
      }).success,
    ).toBe(false);
  });

  it('rejects invalid confidence on a candidate', () => {
    expect(
      LightRetroSchema.safeParse({
        ...baseValid,
        improvementCandidates: [{ ...baseValid.improvementCandidates[0], confidence: 'very-high' }],
      }).success,
    ).toBe(false);
  });

  it('rejects invalid outcome', () => {
    expect(LightRetroSchema.safeParse({ ...baseValid, outcome: 'unknown' }).success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces a valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(LightRetroSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
  });
});

describe('retrospective-light skill config', () => {
  it('has role retrospector', () => {
    expect(config.role).toBe('retrospector');
  });

  it('is pinned to sonnet (light retro is routine analysis, not deep reasoning)', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('is not a holdout (retrospector sees run history)', () => {
    expect(config.freshContext).toBe(false);
  });
});
