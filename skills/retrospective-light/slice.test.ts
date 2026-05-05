import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import config from './config.js';
import { LightRetroSchema } from './schema.js';

const baseValid = {
  summary:
    '- Tests all pass.\n- One minor lint warning auto-fixed.\n- Dev followed vertical slice pattern throughout.',
  improvementCandidates: [
    {
      kind: 'skill-prompt',
      targetPath: 'skills/implement/skill.md',
      sourceRunId: 'run-abc',
      sourceProject: 'goose-hub',
      sourceWorkItem: 'shaunnez/goose-hub#42',
      suggestionText: 'Add explicit reminder to check slice.test.ts exists before writing code',
      confidence: 'high',
    },
  ],
  decisionSummaries: [{ kind: 'PLAN', summary: 'Selected light retro — no deep triggers' }],
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

  it('rejects empty summary', () => {
    expect(LightRetroSchema.safeParse({ ...baseValid, summary: '' }).success).toBe(false);
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
