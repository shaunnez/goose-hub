import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import config, { SpecAuthorContextSchema } from './config.js';
import { SpecAuthorSchema } from './schema.js';

describe('spec-author schema', () => {
  it('accepts a fully-populated valid output', () => {
    const result = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/issue-235.spec.ts',
      planSummary:
        'Exercises the new evidence panel: navigate to /projects/foo, open the issue detail view, expand the evidence section, assert the inline screenshot is visible.',
      screenshotsTaken: 4,
      decisionSummaries: [
        {
          kind: 'READ',
          summary: 'Walked the slice scenario via playwright-mcp and captured 4 screenshots',
        },
        {
          kind: 'GREEN',
          summary: 'Wrote spec at apps/web/e2e/issue-235.spec.ts with 3 expect assertions',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts zero screenshotsTaken (skill may use evaluate-only flow)', () => {
    const result = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/issue-99.spec.ts',
      planSummary: 'Asserts API contract via page.evaluate; no visual capture.',
      screenshotsTaken: 0,
      decisionSummaries: [
        { kind: 'GREEN', summary: 'Wrote API-contract spec without screenshots' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts decisionSummary with optional evidence field', () => {
    const result = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/issue-1.spec.ts',
      planSummary: 'Spec.',
      screenshotsTaken: 1,
      decisionSummaries: [
        { kind: 'READ', summary: 'walked it', evidence: 'screenshot at /tmp/exp.png' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing specPath', () => {
    const result = SpecAuthorSchema.safeParse({
      planSummary: 'Some summary.',
      screenshotsTaken: 2,
      decisionSummaries: [{ kind: 'PLAN', summary: 'b' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing planSummary', () => {
    const result = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/x.spec.ts',
      screenshotsTaken: 2,
      decisionSummaries: [{ kind: 'PLAN', summary: 'b' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative screenshotsTaken', () => {
    const result = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/x.spec.ts',
      planSummary: 'p',
      screenshotsTaken: -1,
      decisionSummaries: [{ kind: 'PLAN', summary: 'b' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer screenshotsTaken', () => {
    const result = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/x.spec.ts',
      planSummary: 'p',
      screenshotsTaken: 2.5,
      decisionSummaries: [{ kind: 'PLAN', summary: 'b' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    const result = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/x.spec.ts',
      planSummary: 'p',
      screenshotsTaken: 0,
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects decisionSummary missing step or summary', () => {
    const missingSummary = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/x.spec.ts',
      planSummary: 'p',
      screenshotsTaken: 0,
      decisionSummaries: [{ kind: 'PLAN' }],
    });
    expect(missingSummary.success).toBe(false);

    const missingStep = SpecAuthorSchema.safeParse({
      specPath: 'apps/web/e2e/x.spec.ts',
      planSummary: 'p',
      screenshotsTaken: 0,
      decisionSummaries: [{ summary: 'b' }],
    });
    expect(missingStep.success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(SpecAuthorSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('spec-author skill config', () => {
  it('has role developer (NOT a holdout)', () => {
    expect(config.role).toBe('developer');
  });

  it('declares playwright-mcp tool bundle (per #235 acceptance criteria)', () => {
    expect(config.toolBundles).toContain('playwright-mcp');
  });

  it('also declares read-write so it can write the spec file', () => {
    expect(config.toolBundles).toContain('read-write');
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context (developer skills may use ambient context)', () => {
    expect(config.freshContext).toBe(false);
  });

  it('has contextAllowlist defined and includes targetUrl + sliceDescription', () => {
    expect(config.contextAllowlist).toBeDefined();
    expect(config.contextAllowlist).toContain('targetUrl');
    expect(config.contextAllowlist).toContain('sliceDescription');
    expect(config.contextAllowlist).toContain('workItem.title');
    expect(config.contextAllowlist).toContain('workItem.body');
    expect(config.contextAllowlist).toContain('workItem.number');
  });
});

describe('spec-author context schema', () => {
  it('accepts valid context with all fields', () => {
    const valid = SpecAuthorContextSchema.safeParse({
      workItem: {
        title: 'Add overview screenshots',
        body: 'When I open the overview...',
        number: 235,
      },
      targetUrl: 'http://localhost:5173/projects/goose-hub',
      sliceDescription: 'Open the overview, see the inline screenshot from the linked PR.',
    });
    expect(valid.success).toBe(true);
  });

  it('rejects missing targetUrl', () => {
    const invalid = SpecAuthorContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      sliceDescription: 's',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects missing sliceDescription', () => {
    const invalid = SpecAuthorContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      targetUrl: 'http://localhost:5173',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects missing workItem.number', () => {
    const invalid = SpecAuthorContextSchema.safeParse({
      workItem: { title: 't', body: 'b' },
      targetUrl: 'http://localhost:5173',
      sliceDescription: 's',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects workItem.number as a string (must be number)', () => {
    const invalid = SpecAuthorContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: '235' },
      targetUrl: 'http://localhost:5173',
      sliceDescription: 's',
    });
    expect(invalid.success).toBe(false);
  });
});
