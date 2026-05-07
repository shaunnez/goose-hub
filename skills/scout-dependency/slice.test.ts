import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './schema.js';
import config, { ScoutDependencyContextSchema } from './skill.config.js';

describe('scout-dependency skill', () => {
  it('accepts a valid scout output', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [
        {
          file: 'core/agent-runtime/swarm.ts',
          line: 1,
          fact: 'imports @goose-hub/core/event-stream/store.js',
          confidence: 'high',
        },
      ],
      decisionSummaries: [{ kind: 'READ', summary: 'mapped imports of swarm.ts' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('config is read-only investigator with freshContext: true', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
  });

  it('contextSchema accepts the canonical scout context shape', () => {
    const result = ScoutDependencyContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutFocus: 'map deps of agent-runtime',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });
});
