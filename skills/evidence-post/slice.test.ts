import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { EvidencePostSchema } from './schema.js';
import config, { EvidencePostContextSchema } from './skill.config.js';

describe('evidence-post schema', () => {
  it('accepts a fully-populated valid output', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [
        {
          path: 'evidence/issue-233/step-1.png',
          caption: 'Project overview before evidence panel',
          step: 1,
          githubUrl:
            'https://raw.githubusercontent.com/shaunnez/goose-hub/abc1234/evidence/issue-233/step-1.png',
        },
        {
          path: 'evidence/issue-233/step-2.png',
          caption: 'Evidence panel expanded with inline screenshot',
          step: 2,
        },
      ],
      gifPath: 'evidence/issue-233/walkthrough.gif',
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/233#issuecomment-9876543210',
      commitSha: 'abc1234def5678901234567890abcdef12345678',
      decisionSummaries: [
        { kind: 'PLAN', summary: 'Ran spec; captured 2 screenshots and a GIF' },
        { kind: 'COMMIT', summary: 'Posted comment on issue #233 with SHA-pinned URLs' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts gifPath as null (no GIF captured)', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [{ path: 'evidence/issue-233/step-1.png', caption: 'Initial state', step: 1 }],
      gifPath: null,
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/233#issuecomment-1',
      commitSha: 'abc1234',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Captured screenshot only' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty screenshots array (when only the GIF matters)', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [],
      gifPath: 'evidence/issue-233/walkthrough.gif',
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/233#issuecomment-1',
      commitSha: 'abc1234',
      decisionSummaries: [{ kind: 'PLAN', summary: 'GIF-only capture' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts short SHA (≥ 7 chars)', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [],
      gifPath: null,
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/1#issuecomment-1',
      commitSha: 'abc1234',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'posted' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects SHA shorter than 7 chars', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [],
      gifPath: null,
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/1#issuecomment-1',
      commitSha: 'abc12',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'posted' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-URL commentUrl', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [],
      gifPath: null,
      commentUrl: 'not-a-url',
      commitSha: 'abc1234',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'posted' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [],
      gifPath: null,
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/1#issuecomment-1',
      commitSha: 'abc1234',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot missing path', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [{ caption: 'no path', step: 1 }],
      gifPath: null,
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/1#issuecomment-1',
      commitSha: 'abc1234',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'posted' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot.step as float (must be integer)', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [{ path: 'evidence/issue-1/step-1.png', caption: 'c', step: 1.5 }],
      gifPath: null,
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/1#issuecomment-1',
      commitSha: 'abc1234',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'posted' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-URL githubUrl on a screenshot', () => {
    const result = EvidencePostSchema.safeParse({
      screenshots: [
        { path: 'evidence/issue-1/step-1.png', caption: 'c', step: 1, githubUrl: 'not-a-url' },
      ],
      gifPath: null,
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/1#issuecomment-1',
      commitSha: 'abc1234',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'posted' }],
    });
    expect(result.success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(EvidencePostSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('evidence-post skill config', () => {
  it('has role developer (NOT a holdout)', () => {
    expect(config.role).toBe('developer');
  });

  it('declares validate tool bundle (Playwright + git push)', () => {
    expect(config.toolBundles).toContain('validate');
  });

  it('does NOT declare playwright-mcp (this skill runs the spec, does not author it)', () => {
    expect(config.toolBundles).not.toContain('playwright-mcp');
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('contextAllowlist includes workItem fields, prNumber, prHeadSha, specPath', () => {
    expect(config.contextAllowlist).toContain('workItem.number');
    expect(config.contextAllowlist).toContain('workItem.repo');
    expect(config.contextAllowlist).toContain('workItem.title');
    expect(config.contextAllowlist).toContain('workItem.beforeCommentUrl');
    expect(config.contextAllowlist).toContain('prNumber');
    expect(config.contextAllowlist).toContain('prHeadSha');
    expect(config.contextAllowlist).toContain('specPath');
  });
});

describe('evidence-post context schema', () => {
  it('accepts valid context', () => {
    const valid = EvidencePostContextSchema.safeParse({
      workItem: { number: 233, repo: 'shaunnez/goose-hub', title: 'Add evidence panel' },
      prNumber: 999,
      prHeadSha: 'abc1234def5678901234567890abcdef12345678',
      specPath: 'apps/web/e2e/issue-233.spec.ts',
    });
    expect(valid.success).toBe(true);
  });

  it('accepts valid context with beforeCommentUrl present (type:bug)', () => {
    const valid = EvidencePostContextSchema.safeParse({
      workItem: {
        number: 233,
        repo: 'shaunnez/goose-hub',
        title: 'Login crashes',
        beforeCommentUrl: 'https://github.com/shaunnez/goose-hub/issues/233#issuecomment-1',
      },
      prNumber: 999,
      prHeadSha: 'abc1234',
      specPath: 'apps/web/e2e/issue-233.spec.ts',
    });
    expect(valid.success).toBe(true);
  });

  it('rejects non-URL beforeCommentUrl', () => {
    const invalid = EvidencePostContextSchema.safeParse({
      workItem: {
        number: 233,
        repo: 'shaunnez/goose-hub',
        title: 't',
        beforeCommentUrl: 'not-a-url',
      },
      prNumber: 999,
      prHeadSha: 'abc1234',
      specPath: 'apps/web/e2e/x.spec.ts',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects prHeadSha shorter than 7 chars', () => {
    const invalid = EvidencePostContextSchema.safeParse({
      workItem: { number: 233, repo: 'shaunnez/goose-hub', title: 't' },
      prNumber: 999,
      prHeadSha: 'abc',
      specPath: 'apps/web/e2e/x.spec.ts',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects missing workItem.repo', () => {
    const invalid = EvidencePostContextSchema.safeParse({
      workItem: { number: 233, title: 't' },
      prNumber: 999,
      prHeadSha: 'abc1234',
      specPath: 'apps/web/e2e/x.spec.ts',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects missing prNumber', () => {
    const invalid = EvidencePostContextSchema.safeParse({
      workItem: { number: 233, repo: 'shaunnez/goose-hub', title: 't' },
      prHeadSha: 'abc1234',
      specPath: 'apps/web/e2e/x.spec.ts',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects missing specPath', () => {
    const invalid = EvidencePostContextSchema.safeParse({
      workItem: { number: 233, repo: 'shaunnez/goose-hub', title: 't' },
      prNumber: 999,
      prHeadSha: 'abc1234',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects workItem.number as a string', () => {
    const invalid = EvidencePostContextSchema.safeParse({
      workItem: { number: '233', repo: 'shaunnez/goose-hub', title: 't' },
      prNumber: 999,
      prHeadSha: 'abc1234',
      specPath: 'apps/web/e2e/x.spec.ts',
    });
    expect(invalid.success).toBe(false);
  });
});
