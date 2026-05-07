import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { DecomposeOutputSchema, DecomposedIssueSchema } from './schema.js';
import config, { DecomposeIssuesContextSchema } from './skill.config.js';

const validDecisionSummary = { kind: 'PLAN' as const, summary: 'Decomposed PRD into slices' };

const validIssue = {
  title: 'M13.01: implement core schema',
  body: '## Context\n\nPart of #100.\n\n## Acceptance criteria\n\n- [ ] Schema defined\n\n## Depends on\n\nNo prior sibling dependencies.',
  labels: [
    'factory:accepted',
    'type:feature',
    'priority:medium',
    'schedule:current',
    'exec:serial',
  ],
  dependsOn: [],
};

describe('DecomposeOutputSchema', () => {
  it('accepts valid full output', () => {
    const result = DecomposeOutputSchema.safeParse({
      issues: [validIssue],
      decisionSummaries: [validDecisionSummary],
    });
    expect(result.success).toBe(true);
  });

  it('accepts single-slice PRD with empty dependsOn', () => {
    const result = DecomposeOutputSchema.safeParse({
      issues: [{ ...validIssue, dependsOn: [] }],
      decisionSummaries: [validDecisionSummary],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multi-slice with valid sequential deps (issue 1 dependsOn [0])', () => {
    const result = DecomposeOutputSchema.safeParse({
      issues: [
        { ...validIssue, dependsOn: [] },
        { ...validIssue, title: 'M13.02: build service layer', dependsOn: [0] },
        { ...validIssue, title: 'M13.03: wire routes', dependsOn: [0, 1] },
      ],
      decisionSummaries: [validDecisionSummary],
    });
    expect(result.success).toBe(true);
  });

  it('rejects forward references in dependsOn (n >= own index)', () => {
    // Issue at index 0 references index 1 (forward ref)
    const result = DecomposeOutputSchema.safeParse({
      issues: [
        { ...validIssue, dependsOn: [1] },
        { ...validIssue, title: 'M13.02: second slice', dependsOn: [] },
      ],
      decisionSummaries: [validDecisionSummary],
    });
    expect(result.success).toBe(false);
  });

  it('rejects self-reference in dependsOn (n === own index)', () => {
    const result = DecomposeOutputSchema.safeParse({
      issues: [
        { ...validIssue, dependsOn: [] },
        { ...validIssue, title: 'M13.02: second slice', dependsOn: [1] },
      ],
      decisionSummaries: [validDecisionSummary],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing decisionSummaries', () => {
    const result = DecomposeOutputSchema.safeParse({
      issues: [validIssue],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries array', () => {
    const result = DecomposeOutputSchema.safeParse({
      issues: [validIssue],
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing issues field', () => {
    const result = DecomposeOutputSchema.safeParse({
      decisionSummaries: [validDecisionSummary],
    });
    expect(result.success).toBe(false);
  });

  it('toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(DecomposeOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('DecomposedIssueSchema', () => {
  it('accepts valid issue with non-empty labels', () => {
    const result = DecomposedIssueSchema.safeParse(validIssue);
    expect(result.success).toBe(true);
  });

  it('accepts empty dependsOn array', () => {
    const result = DecomposedIssueSchema.safeParse({ ...validIssue, dependsOn: [] });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const { title: _title, ...rest } = validIssue;
    const result = DecomposedIssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing body', () => {
    const { body: _body, ...rest } = validIssue;
    const result = DecomposedIssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('decompose-issues skill config', () => {
  it('has role decomposer', () => {
    expect(config.role).toBe('decomposer');
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('has core toolBundle', () => {
    expect(config.toolBundles).toContain('core');
  });

  it('has contextAllowlist with expected leaf paths', () => {
    expect(config.contextAllowlist).toContain('parentIssue.number');
    expect(config.contextAllowlist).toContain('parentIssue.title');
    expect(config.contextAllowlist).toContain('parentIssue.body');
    expect(config.contextAllowlist).toContain('prdOutput');
  });

  it('contextSchema accepts valid context', () => {
    const result = DecomposeIssuesContextSchema.safeParse({
      parentIssue: { number: 100, title: 'Implement auth', body: 'Full auth feature.' },
      prdOutput: { slices: [] },
    });
    expect(result.success).toBe(true);
  });

  it('contextSchema rejects missing parentIssue.number', () => {
    const result = DecomposeIssuesContextSchema.safeParse({
      parentIssue: { title: 'Implement auth', body: 'Full auth feature.' },
      prdOutput: {},
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects missing parentIssue.title', () => {
    const result = DecomposeIssuesContextSchema.safeParse({
      parentIssue: { number: 100, body: 'Full auth feature.' },
      prdOutput: {},
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects missing prdOutput', () => {
    const result = DecomposeIssuesContextSchema.safeParse({
      parentIssue: { number: 100, title: 'Implement auth', body: 'body' },
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema accepts prdOutput as unknown (any shape)', () => {
    const result = DecomposeIssuesContextSchema.safeParse({
      parentIssue: { number: 100, title: 'Implement auth', body: 'body' },
      prdOutput: 'string value is fine too',
    });
    expect(result.success).toBe(true);
  });
});
