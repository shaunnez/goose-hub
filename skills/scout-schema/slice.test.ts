import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './schema.js';
import config, { ScoutSchemaContextSchema } from './skill.config.js';

describe('scout-schema skill', () => {
  it('accepts a valid scout output', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [
        {
          file: 'core/db/schema.ts',
          line: 42,
          fact: 'events table column "kind" is text not null',
          confidence: 'high',
        },
      ],
      decisionSummaries: [{ kind: 'READ', summary: 'inspected core/db/schema.ts' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('accepts findings without a line number', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [{ file: 'core/db/schema.ts', fact: 'imports drizzle-orm', confidence: 'medium' }],
      decisionSummaries: [{ kind: 'READ', summary: 'looked at top of file' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty findings list (the area has no schema surface)', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'no schema relevant to issue' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [],
      status: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown status', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [{ kind: 'READ', summary: 'x' }],
      status: 'partial',
    });
    expect(result.success).toBe(false);
  });

  it('rejects findings missing file', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [{ fact: 'x', confidence: 'high' }],
      decisionSummaries: [{ kind: 'READ', summary: 'x' }],
      status: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('config uses read bundle with freshContext: true', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
    expect(config.role).toBe('investigator');
  });

  it('contextSchema accepts the canonical scout context shape', () => {
    const result = ScoutSchemaContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutFocus: 'find email-related schemas',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });
});
