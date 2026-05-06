import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { SkillCoachOutputSchema } from './schema.js';
import config from './skill.config.js';

const baseValid = {
  skillName: 'implement',
  diagnosis: 'Skill lacks explicit reminder to write slice.test.ts before implementation',
  proposedPatch:
    '--- a/skills/implement/prompt.md\n+++ b/skills/implement/prompt.md\n@@ -10,0 +11 @@\n+Before any implementation, write slice.test.ts.',
  rationale:
    'Pattern PLAN::developer recurred 8/10 lifecycles with consistent early-test discipline; the skill prompt does not mention slice.test.ts.',
  evidencePatternIds: ['PLAN::developer'],
  confidence: 'high' as const,
  decisionSummaries: [
    {
      kind: 'VERDICT' as const,
      summary: 'Coached implement: add slice.test.ts reminder to prompt',
    },
  ],
};

describe('SkillCoachOutputSchema', () => {
  it('accepts a fully-populated valid output', () => {
    expect(SkillCoachOutputSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts empty proposedPatch (no change warranted)', () => {
    expect(SkillCoachOutputSchema.safeParse({ ...baseValid, proposedPatch: '' }).success).toBe(
      true,
    );
  });

  it('accepts empty evidencePatternIds (no patterns cited)', () => {
    expect(SkillCoachOutputSchema.safeParse({ ...baseValid, evidencePatternIds: [] }).success).toBe(
      true,
    );
  });

  it('accepts confidence: low', () => {
    expect(SkillCoachOutputSchema.safeParse({ ...baseValid, confidence: 'low' }).success).toBe(
      true,
    );
  });

  it('rejects empty skillName', () => {
    expect(SkillCoachOutputSchema.safeParse({ ...baseValid, skillName: '' }).success).toBe(false);
  });

  it('rejects empty diagnosis', () => {
    expect(SkillCoachOutputSchema.safeParse({ ...baseValid, diagnosis: '' }).success).toBe(false);
  });

  it('rejects empty rationale', () => {
    expect(SkillCoachOutputSchema.safeParse({ ...baseValid, rationale: '' }).success).toBe(false);
  });

  it('rejects empty decisionSummaries', () => {
    expect(SkillCoachOutputSchema.safeParse({ ...baseValid, decisionSummaries: [] }).success).toBe(
      false,
    );
  });

  it('rejects invalid confidence value', () => {
    expect(
      SkillCoachOutputSchema.safeParse({ ...baseValid, confidence: 'very-high' }).success,
    ).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces a valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(SkillCoachOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
  });
});

describe('skill-coach skill config', () => {
  it('has role retrospector', () => {
    expect(config.role).toBe('retrospector');
  });

  it('is pinned to sonnet (reasoning-heavy, diff generation)', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('is not a holdout (reads accumulated pattern history)', () => {
    expect(config.freshContext).toBe(false);
  });

  it('uses core tool bundle', () => {
    expect(config.toolBundles).toContain('core');
  });

  it('includes all required keys in contextAllowlist', () => {
    const allowlist = config.contextAllowlist ?? [];
    expect(allowlist).toContain('projectId');
    expect(allowlist).toContain('targetSkillName');
    expect(allowlist).toContain('skillSourceFiles');
    expect(allowlist).toContain('evidencePatterns');
    expect(allowlist).toContain('evidenceLifecycles');
  });
});
