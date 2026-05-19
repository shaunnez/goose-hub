import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_FACT_CONTRACTS,
  operationalFactContractsByOwner,
} from './operational-fact-owners.js';

describe('operational-fact-owners', () => {
  it('assigns each operational fact to an owner and limits model-authored facts', () => {
    expect(OPERATIONAL_FACT_CONTRACTS.map((contract) => contract.fact)).toEqual([
      'commands run',
      'targeted test paths',
      'changed files',
      'evidence artifacts',
      'PR metadata',
      'state transitions',
      'budget and cost',
      'finding severity and rationale',
    ]);

    for (const contract of OPERATIONAL_FACT_CONTRACTS) {
      expect(contract.owner).toMatch(/^(tool|workflow|collector|runtime|model)$/);
      expect(contract.source.length).toBeGreaterThan(0);
      if (contract.observed) {
        expect(contract.modelMayDeclare).not.toBe('judgment');
      }
    }
  });

  it('groups contracts by owner for prompt and audit consumers', () => {
    const grouped = operationalFactContractsByOwner();
    expect(grouped.tool.map((contract) => contract.fact)).toContain('commands run');
    expect(grouped.workflow.map((contract) => contract.fact)).toContain('changed files');
    expect(grouped.collector.map((contract) => contract.fact)).toContain('evidence artifacts');
    expect(grouped.runtime.map((contract) => contract.fact)).toContain('budget and cost');
    expect(grouped.model.map((contract) => contract.fact)).toEqual([
      'finding severity and rationale',
    ]);
  });
});
