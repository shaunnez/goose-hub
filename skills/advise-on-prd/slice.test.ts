import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { AdvisePRDOutputSchema } from './schema.js';
import config, { AdvisePRDContextSchema } from './skill.config.js';

describe('advise-on-prd output schema', () => {
  it('accepts approve with empty concerns and empty revisedSections', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'approve',
      concerns: [],
      revisedSections: {},
      decisionSummaries: [{ kind: 'VERDICT', summary: 'PRD is complete and well-structured' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts approve with non-empty concerns and empty revisedSections (approved with notes)', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'approve',
      concerns: ['successCriteria[0] could be more measurable'],
      revisedSections: {},
      decisionSummaries: [{ kind: 'VERDICT', summary: 'PRD approved with minor notes on success criteria' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects approve with non-empty revisedSections (superRefine invariant)', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'approve',
      concerns: [],
      revisedSections: { problem: 'rewritten problem statement' },
      decisionSummaries: [{ kind: 'VERDICT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts revise with concerns and partial revisedSections', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'revise',
      concerns: [
        'Problem statement conflates two pain points',
        'Journey J-1 missing error states',
      ],
      revisedSections: {
        problem: 'Revised problem statement',
        successCriteria: 'Revised success criteria',
      },
      decisionSummaries: [{ kind: 'VERDICT', summary: 'PRD needs problem and success criteria revisions' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts revise with empty revisedSections (concerns only, no section patches)', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'revise',
      concerns: ['functionalSpec.behaviors lack when/given/then structure'],
      revisedSections: {},
      decisionSummaries: [{ kind: 'VERDICT', summary: 'PRD revised: functional spec needs structured format' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing decisionSummaries (FACTORY_RULES rule 6)', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'approve',
      concerns: [],
      revisedSections: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries array (FACTORY_RULES rule 6 — min 1)', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'approve',
      concerns: [],
      revisedSections: {},
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects concerns array exceeding 5 items', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'revise',
      concerns: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      revisedSections: {},
      decisionSummaries: [{ kind: 'VERDICT', summary: 'too many concerns' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts concerns array with exactly 5 items', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'revise',
      concerns: ['c1', 'c2', 'c3', 'c4', 'c5'],
      revisedSections: {},
      decisionSummaries: [{ kind: 'VERDICT', summary: 'five concerns on revise' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown verdict value', () => {
    const result = AdvisePRDOutputSchema.safeParse({
      verdict: 'proceed',
      concerns: [],
      revisedSections: {},
      decisionSummaries: [{ kind: 'VERDICT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('toJSONSchema roundtrip produces a valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(AdvisePRDOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
  });
});

describe('advise-on-prd skill config', () => {
  it('role is prd-writer', () => {
    expect(config.role).toBe('prd-writer');
  });

  it('modelPin is opus', () => {
    expect(config.modelPin).toBe('opus');
  });

  it('freshContext is true (CONTEXT.md advisor pattern)', () => {
    expect(config.freshContext).toBe(true);
  });

  it('toolBundles includes read and core', () => {
    expect(config.toolBundles).toContain('read');
    expect(config.toolBundles).toContain('core');
  });

  it('contextAllowlist contains prdOutput and priority leaf paths', () => {
    expect(config.contextAllowlist).toContain('prdOutput');
    expect(config.contextAllowlist).toContain('priority');
  });
});

describe('advise-on-prd context schema', () => {
  it('accepts valid context with prdOutput and priority', () => {
    const result = AdvisePRDContextSchema.safeParse({
      prdOutput: { title: 'My PRD', problem: 'User pain point', decisionSummaries: [] },
      priority: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all priority enum values', () => {
    for (const priority of ['low', 'medium', 'high', 'critical'] as const) {
      const result = AdvisePRDContextSchema.safeParse({
        prdOutput: {},
        priority,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid priority value', () => {
    const result = AdvisePRDContextSchema.safeParse({
      prdOutput: {},
      priority: 'urgent',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing prdOutput', () => {
    const result = AdvisePRDContextSchema.safeParse({
      priority: 'high',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing priority', () => {
    const result = AdvisePRDContextSchema.safeParse({
      prdOutput: {},
    });
    expect(result.success).toBe(false);
  });
});
