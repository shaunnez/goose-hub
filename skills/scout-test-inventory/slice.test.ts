import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './schema.js';
import config, { ScoutTestInventoryContextSchema } from './skill.config.js';

describe('scout-test-inventory skill', () => {
  it('accepts a valid scout output with describe-line citations', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [
        {
          file: 'core/agent-runtime/swarm.test.ts',
          line: 12,
          fact: 'describe("swarm.dispatchWave", ...)',
          confidence: 'high',
        },
      ],
      decisionSummaries: [{ kind: 'READ', summary: 'inventoried agent-runtime tests' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('config is read-only investigator with freshContext: true', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
  });

  it('contextSchema accepts the canonical scout context shape', () => {
    const result = ScoutTestInventoryContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutFocus: 'inventory tests for state-machine',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });
});
