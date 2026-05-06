import { describe, expect, it } from 'vitest';
import config from './config.js';
import { SkillCoachInputSchema, SkillCoachOutputSchema } from './schema.js';

describe('SkillCoachOutputSchema', () => {
  it('accepts valid output with all fields', () => {
    const result = SkillCoachOutputSchema.safeParse({
      skillName: 'investigate',
      diagnosis: 'Evidence shows consistent need for clarification on sandbox boundaries.',
      proposedPatch:
        '--- a/skills/investigate/skill.md\n+++ b/skills/investigate/skill.md\n@@ -10,3 +10,4 @@\n clarify sandbox boundaries in the prompt\n',
      rationale: 'Unified guidance reduces coach requests across 8 lifecycles.',
      evidencePatternIds: ['pattern-1', 'pattern-2', 'pattern-3'],
      confidence: 'high',
      decisionSummaries: [
        { kind: 'PLAN', summary: 'Analyzed convergent patterns from 3 lifecycles' },
        { kind: 'GREEN', summary: 'Proposed patch addresses all identified gaps' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('requires at least one decisionSummary', () => {
    const result = SkillCoachOutputSchema.safeParse({
      skillName: 'investigate',
      diagnosis: 'Some pattern.',
      proposedPatch: 'diff',
      rationale: 'Improves clarity.',
      evidencePatternIds: [],
      confidence: 'medium',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts low confidence with evidence', () => {
    const result = SkillCoachOutputSchema.safeParse({
      skillName: 'investigate',
      diagnosis: 'Weak pattern detected.',
      proposedPatch: 'diff',
      rationale: 'Minor improvement.',
      evidencePatternIds: ['p1'],
      confidence: 'low',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Low confidence; human review needed' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid confidence', () => {
    const result = SkillCoachOutputSchema.safeParse({
      skillName: 'investigate',
      diagnosis: 'Pattern.',
      proposedPatch: 'diff',
      rationale: 'Improves.',
      evidencePatternIds: [],
      confidence: 'very-high',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Test' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty evidencePatternIds', () => {
    const result = SkillCoachOutputSchema.safeParse({
      skillName: 'investigate',
      diagnosis: 'Pattern.',
      proposedPatch: 'diff',
      rationale: 'Improves.',
      evidencePatternIds: [],
      confidence: 'medium',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Test' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('SkillCoachInputSchema', () => {
  it('accepts valid input with required fields', () => {
    const result = SkillCoachInputSchema.safeParse({
      targetSkillName: 'investigate',
      patternIds: ['p1', 'p2'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts input with optional lifecycleIds', () => {
    const result = SkillCoachInputSchema.safeParse({
      targetSkillName: 'investigate',
      patternIds: ['p1'],
      lifecycleIds: ['l1', 'l2'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing targetSkillName', () => {
    const result = SkillCoachInputSchema.safeParse({
      patternIds: ['p1'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing patternIds', () => {
    const result = SkillCoachInputSchema.safeParse({
      targetSkillName: 'investigate',
    });
    expect(result.success).toBe(false);
  });
});

describe('config', () => {
  it('uses core bundle', () => {
    expect(config.toolBundles).toEqual(['core']);
  });

  it('pins model to sonnet', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('lists exactly the three context keys', () => {
    expect(config.contextAllowlist).toStrictEqual([
      'targetSkillName',
      'patternIds',
      'lifecycleIds',
    ]);
  });

  it('has freshContext false', () => {
    expect(config.freshContext).toBe(false);
  });
});
