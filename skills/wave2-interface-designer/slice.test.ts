import { describe, expect, it } from 'vitest';
import { Wave2InterfaceDesignerSchema } from './schema.js';
import config, { Wave2InterfaceDesignerContextSchema } from './skill.config.js';

describe('wave2-interface-designer skill', () => {
  it('accepts a valid output with one paste-ready Zod schema artefact', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      artefacts: [
        {
          kind: 'zod-schema',
          targetPath: 'core/x/schema.ts',
          body: 'export const FooSchema = z.object({ id: z.string() });',
          rationale: 'scout-schema saw id text not null at core/db/schema.ts:12',
        },
      ],
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'Designed FooSchema' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an artefact with empty body (paste-ready required)', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      artefacts: [{ kind: 'zod-schema', targetPath: 'x.ts', body: '', rationale: 'r' }],
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown artefact kind', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      artefacts: [{ kind: 'pseudocode', targetPath: 'x.ts', body: 'x', rationale: 'y' }],
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries', () => {
    const result = Wave2InterfaceDesignerSchema.safeParse({
      artefacts: [],
      openQuestions: [],
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
});
