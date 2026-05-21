import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IssueEnhanceOutputSchema } from './schema.js';
import config, { IssueEnhanceContextSchema } from './skill.config.js';

const PROMPT = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

describe('IssueEnhanceOutputSchema', () => {
  it('accepts valid output for a feature enhancement', () => {
    const result = IssueEnhanceOutputSchema.safeParse({
      enhancedContent:
        '**Problem**\nUsers cannot save a draft from the idea promotion flow.\n\n**Desired outcome**\nUsers can save a draft and return later.\n\n**Implementation notes**\n- Reuse the existing modal save action\n- Preserve current form state when the modal closes',
      decisionSummaries: [
        {
          kind: 'PLAN',
          summary: 'Added problem, desired outcome, and implementation notes sections',
          evidence: 'request describes a missing save-draft capability',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects output missing decisionSummaries', () => {
    const result = IssueEnhanceOutputSchema.safeParse({
      enhancedContent: '**Problem**\nMissing draft save support',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('issue-enhance skill config', () => {
  it('has triager role and no tool bundles', () => {
    expect(config.role).toBe('triager');
    expect(config.toolBundles).toHaveLength(0);
  });

  it('validates feature, chore, and research work item types', () => {
    for (const type of ['feature', 'chore', 'research'] as const) {
      const result = IssueEnhanceContextSchema.safeParse({
        workItem: {
          type,
          title: 'Improve promotion flow',
          body: 'Allow enhancement for non-bug promotions.',
        },
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects bug work items for the generic enhancer', () => {
    const result = IssueEnhanceContextSchema.safeParse({
      workItem: {
        type: 'bug',
        title: 'Fix broken modal',
        body: 'The modal does not open.',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('issue-enhance prompt guidance', () => {
  it('mentions type-aware enhancement guidance for non-bug issue types', () => {
    expect(PROMPT).toContain('feature, chore, or research');
    expect(PROMPT).toContain('type-aware');
    expect(PROMPT).not.toContain('Repro steps');
    expect(PROMPT).not.toContain('Expected');
    expect(PROMPT).not.toContain('Actual');
  });
});
