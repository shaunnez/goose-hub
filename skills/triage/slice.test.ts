import { readFileSync } from 'node:fs';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { describe, expect, it } from 'vitest';
import { TriageOutputSchema } from './schema.js';
import config, { TriageContextSchema } from './skill.config.js';

const PROMPT = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

describe('triage schema', () => {
  it('accepts valid output with all required fields', () => {
    const result = TriageOutputSchema.safeParse({
      type: 'feature',
      priority: 'p2',
      labels: ['needs-design'],
      reasoning: 'This is a new capability with no urgency signals.',
      decisionSummaries: [
        {
          kind: 'PLAN',
          summary: 'Classified as feature',
          evidence: 'new capability',
        },
        {
          kind: 'ESCALATE',
          summary: 'Classified as p2',
          evidence: 'no urgency signals',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty labels array', () => {
    const result = TriageOutputSchema.safeParse({
      type: 'bug',
      priority: 'p0',
      labels: [],
      reasoning: 'Production regression.',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Bug', evidence: 'broken' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type value', () => {
    const result = TriageOutputSchema.safeParse({
      type: 'invalid',
      priority: 'p1',
      labels: [],
      reasoning: 'x',
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority value', () => {
    const result = TriageOutputSchema.safeParse({
      type: 'chore',
      priority: 'critical',
      labels: [],
      reasoning: 'x',
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = TriageOutputSchema.safeParse({ type: 'feature' });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries array', () => {
    const result = TriageOutputSchema.safeParse({
      type: 'research',
      priority: 'p3',
      labels: [],
      reasoning: 'x',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts evidence as optional on DecisionSummary', () => {
    const result = TriageOutputSchema.safeParse({
      type: 'chore',
      priority: 'p3',
      labels: [],
      reasoning: 'Routine cleanup.',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Chore' }],
    });
    expect(result.success).toBe(true);
  });

  it('runtime JSON Schema omits optional decision summary evidence', () => {
    const jsonSchema = toJsonSchema(TriageOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
    const properties = jsonSchema.properties as Record<string, unknown>;
    const decisionSummaries = properties.decisionSummaries as { items?: unknown };
    const item = decisionSummaries.items as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(item.properties).not.toHaveProperty('evidence');
    expect(item.required).toEqual(['kind', 'summary']);
  });
});

describe('triage skill config', () => {
  it('has role triager', () => {
    expect(config.role).toBe('triager');
  });

  it('has empty toolBundles', () => {
    expect(config.toolBundles).toHaveLength(0);
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('contextSchema validates required workItem fields', () => {
    const valid = TriageContextSchema.safeParse({
      workItem: { title: 'Fix auth bug', body: 'Auth breaks on login.' },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem.title', () => {
    const invalid = TriageContextSchema.safeParse({
      workItem: { body: 'Some body.' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.body', () => {
    const invalid = TriageContextSchema.safeParse({
      workItem: { title: 'Some title' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem entirely', () => {
    const invalid = TriageContextSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });
});

describe('triage prompt discipline', () => {
  it('forbids memory and skill quick passes', () => {
    expect(PROMPT).toContain('No memory or skill quick pass');
    expect(PROMPT).toContain('Do not read local assistant memory');
    expect(PROMPT).toContain('~/.codex');
    expect(PROMPT).toContain('~/.agents');
    expect(PROMPT).toContain('~/.claude');
  });
});
