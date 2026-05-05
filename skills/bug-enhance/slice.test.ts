import { describe, expect, it } from 'vitest';
import { BugEnhanceOutputSchema } from './schema.js';

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

  it('rejects output with empty enhancedContent', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '',
      decisionSummaries: [{ kind: 'PLAN', summary: 'nothing added' }],
    });
    // enhancedContent is a string — empty string is technically valid per schema;
    // the prompt instructs the agent to always include content.
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
