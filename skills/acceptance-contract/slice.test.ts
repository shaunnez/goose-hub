import { describe, expect, it } from 'vitest';
import { AcceptanceContractOutputSchema } from './schema.js';
import config, { AcceptanceContractContextSchema } from './skill.config.js';

describe('acceptance-contract skill', () => {
  it('validates a minimal contract output', () => {
    expect(
      AcceptanceContractOutputSchema.safeParse({
        criteria: [{ id: 'AC-1', statement: 'The result is observable.' }],
        issueBodyPatchRecommended: true,
        decisionSummaries: [{ kind: 'PLAN', summary: 'Authored acceptance criteria' }],
      }).success,
    ).toBe(true);
  });

  it('declares only contract-authoring context', () => {
    expect(
      AcceptanceContractContextSchema.safeParse({
        workItem: {
          title: 'Fix sorting',
          body: 'Expected newest first',
          number: 927,
          type: 'bug',
          priority: 'medium',
        },
        investigation: { findings: 'Sort helper is reversed', keyFiles: [], openQuestions: [] },
      }).success,
    ).toBe(true);
    expect(config.contextAllowlist).toEqual(['workItem', 'investigation', 'existingCriteria']);
  });
});
