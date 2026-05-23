import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Wave2InterfaceDesignerSchema } from './schema.js';
import config, { Wave2InterfaceDesignerContextSchema } from './skill.config.js';

describe('wave2-interface-designer skill', () => {
  it('accepts a valid output with one paste-ready artefact finding', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      findings: [
        {
          file: 'core/x/schema.ts',
          fact: 'ARTEFACT[zod-schema]: export const FooSchema = z.object({ id: z.string() }); | RATIONALE: scout-schema saw id text not null at core/db/schema.ts:12',
          confidence: 'high',
        },
      ],
      status: 'ok',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Designed FooSchema' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a finding with empty fact', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      findings: [{ file: 'core/x/schema.ts', fact: '', confidence: 'high' }],
      status: 'ok',
      decisionSummaries: [{ kind: 'PLAN', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid status value', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      findings: [],
      status: 'success',
      decisionSummaries: [{ kind: 'PLAN', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      findings: [],
      status: 'ok',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('config is read-only investigator with freshContext: true', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.freshContext).toBe(true);
    expect(config.role).toBe('investigator');
    expect(config.modelPin).toBe('sonnet');
  });

  it('contextSchema accepts the canonical wave2 context shape', () => {
    const result = Wave2InterfaceDesignerContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      scoutReports: '[]',
      worktreePath: '/tmp/x',
    });
    expect(result.success).toBe(true);
  });

  it('prompt enforces bounded UI-oriented handoff design instead of rediscovery', () => {
    const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

    expect(prompt).toContain('at most 5 total read/search calls');
    expect(prompt).toContain(
      'Never read the same file twice unless the first result was truncated',
    );
    expect(prompt).toContain(
      'Once the target boundary and artefact shape are known, stop using tools',
    );
    expect(prompt).toContain('Treat `<scoutDigest>` as primary evidence');
    expect(prompt).toContain("kind: 'component-contract'");
    expect(prompt).toContain("kind: 'state-transition'");
    expect(prompt).toContain("kind: 'test-contract'");
    expect(prompt).toContain("kind: 'props-contract'");
    expect(prompt).toContain('OPEN_QUESTION');
    expect(prompt).toContain('UI state-transition example');
  });
});
