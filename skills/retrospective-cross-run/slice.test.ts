import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import {
  CostBaselineSchema,
  CrossRunPatternSchema,
  CrossRunRetroOutputSchema,
  GateThresholdSchema,
} from './schema.js';
import config from './skill.config.js';

const baseValid = {
  outcome: 'success' as const,
  workItemNumber: 0,
  windowStartAt: '2026-04-01T00:00:00Z',
  windowEndAt: '2026-05-01T00:00:00Z',
  lifecycleCount: 12,
  summary: {
    wentWell: 'TDD discipline held across 11/12 lifecycles',
    didNotGoWell: 'Out-of-scope settings.json edits recurred in 3 runs',
    architecturalTakeaway: 'Reviewer AC inference is consistent — formalize it as a workflow step',
  },
  aggregatedLearnings: [
    {
      observation: 'Reviewers independently infer ACs from prose when no checkboxes exist',
      rationale: 'Inference cost is paid 4× per merge; codifying ACs would amortise it',
      improvementKind: 'workflow' as const,
      confidence: 'high' as const,
    },
  ],
  topPatterns: [
    {
      patternId: 'PLAN::developer',
      pattern: 'Developer writes tests before any implementation',
      occurrenceCount: 11,
      consistencyScore: 0.92,
      role: 'developer',
      kind: 'PLAN',
      exampleWorkItemIds: ['github:owner/repo#501', 'github:owner/repo#502'],
    },
  ],
  gateThresholds: [
    {
      gate: 'qa' as const,
      mean: 82.4,
      min: 70,
      max: 95,
      stdDev: 6.8,
      sampleCount: 12,
    },
    {
      gate: 'review' as const,
      mean: 88.1,
      min: 78,
      max: 96,
      stdDev: 5.2,
      sampleCount: 12,
    },
  ],
  costBaselines: [
    {
      role: 'developer',
      skill: 'implement',
      mean: 0.42,
      p50: 0.38,
      p95: 0.71,
      sampleCount: 12,
    },
  ],
  improvementCandidates: [
    {
      kind: 'skill-prompt' as const,
      targetPath: 'skills/implement/prompt.md',
      suggestionText: 'Add explicit reminder to write slice.test.ts first',
      confidence: 'high' as const,
      evidence: 'pattern:PLAN::developer recurred 11/12 times',
    },
  ],
  decisionSummaries: [
    {
      kind: 'VERDICT' as const,
      summary: 'Cross-run playbook: TDD strong, formalize ACs',
    },
  ],
};

describe('CrossRunRetroOutputSchema', () => {
  it('accepts a fully-populated valid manifest', () => {
    expect(CrossRunRetroOutputSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts empty aggregatedLearnings, topPatterns, gateThresholds, costBaselines', () => {
    expect(
      CrossRunRetroOutputSchema.safeParse({
        ...baseValid,
        aggregatedLearnings: [],
        topPatterns: [],
        gateThresholds: [],
        costBaselines: [],
        improvementCandidates: [],
      }).success,
    ).toBe(true);
  });

  it('accepts lifecycleCount of 0 (empty window)', () => {
    expect(CrossRunRetroOutputSchema.safeParse({ ...baseValid, lifecycleCount: 0 }).success).toBe(
      true,
    );
  });

  it('rejects skill-prompt candidate without evidence citing a pattern id', () => {
    const result = CrossRunRetroOutputSchema.safeParse({
      ...baseValid,
      improvementCandidates: [
        {
          kind: 'skill-prompt' as const,
          targetPath: 'skills/implement/prompt.md',
          suggestionText: 'Add explicit reminder to write slice.test.ts first',
          confidence: 'high' as const,
          evidence: 'general observation, no specific pattern',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects skill-schema candidate with missing evidence', () => {
    const result = CrossRunRetroOutputSchema.safeParse({
      ...baseValid,
      improvementCandidates: [
        {
          kind: 'skill-schema' as const,
          targetPath: 'skills/implement/schema.ts',
          suggestionText: 'Add fooBar field',
          confidence: 'high' as const,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts skill-config candidate when evidence cites a pattern id', () => {
    const result = CrossRunRetroOutputSchema.safeParse({
      ...baseValid,
      improvementCandidates: [
        {
          kind: 'skill-config' as const,
          targetPath: 'skills/implement/skill.config.ts',
          suggestionText: 'Increase maxTurns budget',
          confidence: 'high' as const,
          evidence: 'pattern:RETRY::developer recurs 4× per window',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts workflow candidate without pattern id evidence (rule only applies to skill-* kinds)', () => {
    const result = CrossRunRetroOutputSchema.safeParse({
      ...baseValid,
      improvementCandidates: [
        {
          kind: 'workflow' as const,
          targetPath: 'docs/PLAN.md',
          suggestionText: 'Document AC checklist requirement',
          confidence: 'high' as const,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty windowStartAt', () => {
    expect(CrossRunRetroOutputSchema.safeParse({ ...baseValid, windowStartAt: '' }).success).toBe(
      false,
    );
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    expect(
      CrossRunRetroOutputSchema.safeParse({ ...baseValid, decisionSummaries: [] }).success,
    ).toBe(false);
  });

  it('rejects unknown gate name', () => {
    expect(
      CrossRunRetroOutputSchema.safeParse({
        ...baseValid,
        gateThresholds: [{ ...baseValid.gateThresholds[0], gate: 'lint' }],
      }).success,
    ).toBe(false);
  });

  it('rejects negative stdDev', () => {
    expect(
      CrossRunRetroOutputSchema.safeParse({
        ...baseValid,
        gateThresholds: [{ ...baseValid.gateThresholds[0], stdDev: -1 }],
      }).success,
    ).toBe(false);
  });

  it('rejects consistencyScore outside [0, 1]', () => {
    expect(
      CrossRunRetroOutputSchema.safeParse({
        ...baseValid,
        topPatterns: [{ ...baseValid.topPatterns[0], consistencyScore: 1.4 }],
      }).success,
    ).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces a valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(CrossRunRetroOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
  });
});

describe('GateThresholdSchema', () => {
  it('accepts all-zero thresholds (empty window)', () => {
    expect(
      GateThresholdSchema.safeParse({
        gate: 'qa',
        mean: 0,
        min: 0,
        max: 0,
        stdDev: 0,
        sampleCount: 0,
      }).success,
    ).toBe(true);
  });
});

describe('CostBaselineSchema', () => {
  it('rejects negative mean cost', () => {
    expect(
      CostBaselineSchema.safeParse({
        role: 'developer',
        skill: 'implement',
        mean: -0.1,
        p50: 0.5,
        p95: 0.9,
        sampleCount: 4,
      }).success,
    ).toBe(false);
  });
});

describe('CrossRunPatternSchema', () => {
  it('requires patternId and pattern strings', () => {
    expect(
      CrossRunPatternSchema.safeParse({
        patternId: 'p1',
        pattern: '',
        occurrenceCount: 1,
        consistencyScore: 0.5,
      }).success,
    ).toBe(false);
  });
});

describe('retrospective-cross-run skill config', () => {
  it('has role retrospector', () => {
    expect(config.role).toBe('retrospector');
  });

  it('is pinned to sonnet (structured analysis, not coding)', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('is not a holdout (cross-run retro reads archived run history)', () => {
    expect(config.freshContext).toBe(false);
  });
});
