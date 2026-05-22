import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IdeaPromotionEnhanceOutputSchema } from './schema.js';
import ideaPromotionEnhanceConfig, { IdeaPromotionEnhanceContextSchema } from './skill.config.js';

describe('skills/idea-promotion-enhance skill.config', () => {
  it('accepts the supported non-bug promotion types', () => {
    for (const type of ['feature', 'chore', 'research'] as const) {
      expect(() =>
        IdeaPromotionEnhanceContextSchema.parse({
          workItem: { type, title: `${type} title`, body: `${type} body` },
        }),
      ).not.toThrow();
    }
  });

  it('rejects bug and missing types so the non-bug enhancer is not misrouted', () => {
    expect(() =>
      IdeaPromotionEnhanceContextSchema.parse({
        workItem: { type: 'bug', title: 'bug title', body: 'bug body' },
      }),
    ).toThrow();
    expect(() =>
      IdeaPromotionEnhanceContextSchema.parse({
        workItem: { title: 'missing type', body: 'body' },
      }),
    ).toThrow();
  });

  it('keeps the runtime contract aligned with bug-enhance', () => {
    expect(ideaPromotionEnhanceConfig.contextAllowlist).toEqual(['workItem']);
    expect(ideaPromotionEnhanceConfig.toolBundles).toEqual([]);
    expect(ideaPromotionEnhanceConfig.modelPin).toBe('sonnet');
    expect(ideaPromotionEnhanceConfig.role).toBe('triager');
    expect(ideaPromotionEnhanceConfig.freshContext).toBe(false);
  });

  it('documents type-specific instructions in the prompt', () => {
    const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');
    expect(prompt).toContain('feature');
    expect(prompt).toContain('chore');
    expect(prompt).toContain('research');
    expect(prompt).toContain('Feature Summary');
    expect(prompt).toContain('Execution Notes');
    expect(prompt).toContain('Research Goal');
  });
});

describe('IdeaPromotionEnhanceOutputSchema', () => {
  it('accepts enhanced markdown for a supported promotion', () => {
    const result = IdeaPromotionEnhanceOutputSchema.safeParse({
      enhancedContent:
        '**Feature Summary**\nClarifies the user-facing problem.\n\n**Acceptance Notes**\n- Capture the expected workflow.',
      decisionSummaries: [
        {
          kind: 'PLAN',
          summary: 'Added feature framing for the promoted idea',
          evidence: 'Original idea asked for clearer workflow goals',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('requires at least one decision summary', () => {
    const result = IdeaPromotionEnhanceOutputSchema.safeParse({
      enhancedContent: '**Chore Summary**\nRoutine maintenance context.',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });
});
