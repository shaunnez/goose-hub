import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './schema.js';
import config, { ScoutUserJourneyContextSchema } from './skill.config.js';

describe('scout-user-journey skill', () => {
  it('accepts a valid scout output', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [
        {
          file: 'apps/web/src/components/Login.tsx',
          line: 87,
          fact: '<button>Sign in</button>',
          confidence: 'high',
        },
      ],
      decisionSummaries: [{ kind: 'READ', summary: 'walked login flow' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('config is read-only investigator with freshContext: true', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
  });

  it('contextSchema accepts the canonical scout context shape', () => {
    const result = ScoutUserJourneyContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutFocus: 'walk login flow',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });
});
