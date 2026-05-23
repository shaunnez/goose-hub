import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { InvestigateSchema } from './schema.js';
import config, { InvestigateContextSchema } from './skill.config.js';

const PROMPT = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

describe('investigate schema', () => {
  it('accepts valid output with all required fields', () => {
    const result = InvestigateSchema.safeParse({
      findings:
        'The root cause is a missing null-check in the auth middleware. When the session token is absent, the middleware crashes instead of returning 401.',
      keyFiles: [
        { path: 'apps/server/src/middleware/auth.ts', reason: 'Contains the null-dereference bug' },
        { path: 'apps/server/src/routes/api.ts', reason: 'Calls the auth middleware' },
      ],
      confidence: 'high',
      openQuestions: ['Does this also affect the websocket upgrade path?'],
      requiresBrowserRepro: false,
      decisionSummaries: [
        {
          kind: 'READ',
          summary: 'Read issue #99: auth middleware crashes on missing session token',
          evidence: 'TypeError: Cannot read properties of undefined',
        },
        {
          kind: 'INSIGHT',
          summary: 'Null-check missing in auth.ts line 42',
          evidence: 'apps/server/src/middleware/auth.ts:42',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty keyFiles array', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Could not pinpoint root cause from static analysis alone.',
      keyFiles: [],
      confidence: 'low',
      openQuestions: ['Need runtime logs to identify the failing code path.'],
      requiresBrowserRepro: false,
      decisionSummaries: [{ kind: 'READ', summary: 'Read issue but no clear entry point found' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty openQuestions array', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Root cause is clear: divide-by-zero in calculateRatio().',
      keyFiles: [{ path: 'core/math/ratio.ts', reason: 'Divide-by-zero bug' }],
      confidence: 'high',
      openQuestions: [],
      requiresBrowserRepro: false,
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'Divide-by-zero in calculateRatio()' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts line-precise key files and fix hints', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Root cause is clear: divide-by-zero in calculateRatio().',
      keyFiles: [
        {
          path: 'core/math/ratio.ts',
          reason: 'Divide-by-zero bug',
          line: 42,
          symbol: 'calculateRatio',
          snippet: 'return numerator / denominator;',
        },
      ],
      fixHint: {
        file: 'core/math/ratio.ts',
        line: 42,
        currentCode: 'return numerator / denominator;',
        suggestedApproach: 'Return null or throw before dividing when denominator is zero.',
      },
      confidence: 'high',
      openQuestions: [],
      requiresBrowserRepro: false,
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'Divide-by-zero in calculateRatio()' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts evidence as optional on DecisionSummary', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Investigation complete.',
      keyFiles: [],
      confidence: 'medium',
      openQuestions: [],
      requiresBrowserRepro: false,
      decisionSummaries: [{ kind: 'READ', summary: 'Read and understood the issue' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid confidence value', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Some analysis.',
      keyFiles: [],
      confidence: 'very-high',
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing findings field', () => {
    const result = InvestigateSchema.safeParse({
      keyFiles: [],
      confidence: 'low',
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing confidence field', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Some analysis.',
      keyFiles: [],
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries array', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Some analysis.',
      keyFiles: [],
      confidence: 'medium',
      openQuestions: [],
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing decisionSummaries field', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Some analysis.',
      keyFiles: [],
      confidence: 'medium',
      openQuestions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects keyFile missing path', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Analysis.',
      keyFiles: [{ reason: 'missing path' }],
      confidence: 'low',
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects keyFile missing reason', () => {
    const result = InvestigateSchema.safeParse({
      findings: 'Analysis.',
      keyFiles: [{ path: 'some/file.ts' }],
      confidence: 'low',
      openQuestions: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields entirely', () => {
    const result = InvestigateSchema.safeParse({ confidence: 'high' });
    expect(result.success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(InvestigateSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('investigate skill config', () => {
  it('has role investigator', () => {
    expect(config.role).toBe('investigator');
  });

  it('has read toolBundle', () => {
    expect(config.toolBundles).toContain('read');
  });

  it('is pinned to opus model', () => {
    expect(config.modelPin).toBe('opus');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('contextSchema validates required workItem fields without worktreePath', () => {
    const valid = InvestigateContextSchema.safeParse({
      workItem: { title: 'Fix auth bug', body: 'Auth breaks on login.', number: 42 },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem.title', () => {
    const invalid = InvestigateContextSchema.safeParse({
      workItem: { body: 'body', number: 1 },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.body', () => {
    const invalid = InvestigateContextSchema.safeParse({
      workItem: { title: 'title', number: 1 },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.number', () => {
    const invalid = InvestigateContextSchema.safeParse({
      workItem: { title: 'title', body: 'body' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema accepts missing worktreePath', () => {
    const valid = InvestigateContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem entirely', () => {
    const invalid = InvestigateContextSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });
});

describe('investigate prompt workspace boundary', () => {
  it('forbids memory quick passes and requires exploration inside the rooted workspace', () => {
    expect(PROMPT).toContain('No memory quick pass');
    expect(PROMPT).toContain('Do not perform memory quick passes');
    expect(PROMPT).toContain(
      'All list, read, and search operations must stay inside the workspace already configured for your tools',
    );
    expect(PROMPT).toContain('Do not inspect sibling repos');
    expect(PROMPT).toContain('~/.codex');
    expect(PROMPT).toContain('~/.agents');
    expect(PROMPT).toContain('~/.claude');
  });
});

describe('investigate prompt live decisions', () => {
  it('uses record_decision as the primary live timeline signal', () => {
    expect(PROMPT).toContain('mcp__factory-tools__record_decision');
    expect(PROMPT).toContain('The tool call is the primary live timeline signal');
    expect(PROMPT).toContain('do not rely on text markers alone');
  });
});
