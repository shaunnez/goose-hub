import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BugEnhanceOutputSchema } from './schema.js';
import config, { BugEnhanceContextSchema } from './skill.config.js';

const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

describe('bug-enhance skill contract', () => {
  it('requires workItem.type in the enhancement context', () => {
    expect(
      BugEnhanceContextSchema.safeParse({
        workItem: {
          title: 'Feature request',
          body: 'Add bulk editing',
        },
      }).success,
    ).toBe(false);

    expect(
      BugEnhanceContextSchema.safeParse({
        workItem: {
          title: 'Feature request',
          body: 'Add bulk editing',
          type: 'feature',
        },
      }).success,
    ).toBe(true);
    expect(config.contextSchema).toBe(BugEnhanceContextSchema);
  });

  it('includes type-specific prompt branches for each supported promotion type', () => {
    expect(prompt).toContain('If `workItem.type` is `bug`');
    expect(prompt).toContain('If `workItem.type` is `feature`');
    expect(prompt).toContain('If `workItem.type` is `chore`');
    expect(prompt).toContain('If `workItem.type` is `research`');
  });
});

describe('BugEnhanceOutputSchema', () => {
  it('accepts valid output', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent:
        '**Repro steps**\n1. Navigate to http://localhost:5173/\n2. Observe the sidebar\n\n**Expected**\nSidebar label reads "Goose Hub"\n\n**Actual**\nSidebar label reads "Agentic OS"',
      decisionSummaries: [
        {
          kind: 'PLAN',
          summary: 'Added Repro steps, Expected, Actual, Location sections',
          evidence: 'sidebar label reads "Agentic OS"',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('allows empty enhancedContent when the prompt skips enhancement', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '',
      decisionSummaries: [{ kind: 'PLAN', summary: 'nothing added' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects output missing decisionSummaries', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '**Repro steps**\n1. Navigate to http://localhost:5173/',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });
});
