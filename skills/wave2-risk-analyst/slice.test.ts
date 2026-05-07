import { describe, expect, it } from 'vitest';
import { Wave2RiskAnalystSchema } from './schema.js';
import config, { Wave2RiskAnalystContextSchema } from './skill.config.js';

describe('wave2-risk-analyst skill', () => {
  it('accepts a valid output with one well-formed risk', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      risks: [
        {
          risk: 'URL-decoding drops plus signs in email',
          evidence: 'scout-code-path: apps/server/src/routes/auth.ts:87',
          mitigation: 'Add unit test asserting plus-sign preservation',
          severity: 'high',
        },
      ],
      openQuestions: [],
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'Identified plus-sign risk' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown severity', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      risks: [{ risk: 'r', evidence: 'e', mitigation: 'm', severity: 'critical' }],
      openQuestions: [],
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty fields', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      risks: [{ risk: '', evidence: 'e', mitigation: 'm', severity: 'low' }],
      openQuestions: [],
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries', () => {
    const result = Wave2RiskAnalystSchema.safeParse({
      risks: [],
      openQuestions: [],
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
