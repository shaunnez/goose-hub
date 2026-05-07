import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './schema.js';
import config, { ScoutCodePathContextSchema } from './skill.config.js';

describe('scout-code-path skill', () => {
  it('accepts a valid scout output', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [
        {
          file: 'apps/server/src/routes/auth.ts',
          line: 87,
          fact: 'normaliseEmail() URL-decodes input before DB lookup',
          confidence: 'high',
        },
      ],
      decisionSummaries: [{ kind: 'READ', summary: 'traced from route handler to DB' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('config uses read bundle, freshContext: true, investigator role', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
    expect(config.role).toBe('investigator');
    expect(config.modelPin).toBe('haiku');
  });

  it('contextSchema accepts the canonical scout context shape', () => {
    const result = ScoutCodePathContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutFocus: 'trace login flow',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty decisionSummaries', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [],
      status: 'ok',
    });
    expect(result.success).toBe(false);
  });
});
