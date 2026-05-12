import { describe, expect, it } from 'vitest';
import { Wave2RiskAnalystSchema } from './schema.js';
import config, { Wave2RiskAnalystContextSchema } from './skill.config.js';

describe('wave2-risk-analyst skill', () => {
  it('accepts a valid output with one well-formed risk finding', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      findings: [
        {
          file: 'apps/server/src/routes/auth.ts',
          line: 87,
          fact: 'RISK[high]: URL-decoding drops plus signs in email | EVIDENCE: scout-code-path: apps/server/src/routes/auth.ts:87 | MITIGATION: Add unit test asserting plus-sign preservation',
          confidence: 'high',
        },
      ],
      status: 'ok',
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'Identified plus-sign risk' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a finding with empty fact', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      findings: [{ file: 'apps/server/src/routes/auth.ts', fact: '', confidence: 'high' }],
      status: 'ok',
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid status value', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      findings: [],
      status: 'critical',
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      findings: [],
      status: 'ok',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('config is read-only investigator with freshContext: true', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
    expect(config.modelPin).toBe('sonnet');
  });

  it('contextSchema accepts the canonical wave2 context shape', () => {
    const result = Wave2RiskAnalystContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutReports: '[]',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });
});
