import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './schema.js';
import config, { ScoutPatternContextSchema } from './skill.config.js';

describe('scout-pattern skill', () => {
  it('accepts a valid scout output', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [{ file: 'core/x.ts', line: 1, fact: 'uses Pattern X', confidence: 'high' }],
      decisionSummaries: [{ kind: 'READ', summary: 'searched for Pattern X' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('config is read-only investigator with freshContext: true', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
    expect(config.role).toBe('investigator');
  });

  it('contextSchema accepts the canonical scout context shape', () => {
    const result = ScoutPatternContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutFocus: 'find transitionState callers',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });
});
