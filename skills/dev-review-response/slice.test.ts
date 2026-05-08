import { describe, expect, it } from 'vitest';
import {
  DevReviewResponseContextSchema,
  DevReviewResponseOutputSchema,
  FindingDispositionSchema,
} from './schema.js';
import devReviewResponseConfig from './skill.config.js';

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe('DevReviewResponseOutputSchema', () => {
  it('accepts valid addressed finding', () => {
    const result = DevReviewResponseOutputSchema.safeParse({
      findingDispositions: [
        {
          findingRef: 'core/foo.ts:42',
          severity: 'P1',
          disposition: 'addressed',
          commitSha: 'abc123',
          reason: 'Fixed null check',
        },
      ],
      decisionSummaries: [
        {
          kind: 'DEV_REVIEW_ADDRESSED',
          summary: 'Addressed null dereference at core/foo.ts:42',
          evidence: 'core/foo.ts:42',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid dismissed finding', () => {
    const result = DevReviewResponseOutputSchema.safeParse({
      findingDispositions: [
        {
          findingRef: 'core/bar.ts:10',
          severity: 'P3',
          disposition: 'dismissed',
          reason: 'Style nit — intentional by team convention',
        },
      ],
      decisionSummaries: [
        {
          kind: 'DEV_REVIEW_DISMISSED',
          summary: 'Dismissed P3 style nit at core/bar.ts:10',
          evidence: 'core/bar.ts:10',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty decisionSummaries', () => {
    const result = DevReviewResponseOutputSchema.safeParse({
      findingDispositions: [],
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid disposition value', () => {
    const result = FindingDispositionSchema.safeParse({
      findingRef: 'a.ts:1',
      severity: 'P1',
      disposition: 'maybe',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const result = FindingDispositionSchema.safeParse({
      findingRef: 'a.ts:1',
      severity: 'P9',
      disposition: 'dismissed',
      reason: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Context schema tests ─────────────────────────────────────────────────────

describe('DevReviewResponseContextSchema', () => {
  it('validates a complete context', () => {
    const result = DevReviewResponseContextSchema.safeParse({
      workItem: { title: 'Fix bug', body: 'Details', number: 42, priority: 'high' },
      prDiff: 'diff --git a/foo.ts b/foo.ts\n+added line',
      devReviewFindings: [
        {
          severity: 'P1',
          category: 'correctness',
          file: 'core/foo.ts',
          line: 42,
          summary: 'Null dereference',
          suggestion: 'Add null check',
        },
      ],
      worktreePath: '/tmp/wt-123',
    });
    expect(result.success).toBe(true);
  });

  it('requires devReviewFindings', () => {
    const result = DevReviewResponseContextSchema.safeParse({
      workItem: { title: 'x', body: 'y', number: 1, priority: 'low' },
      prDiff: 'diff',
      worktreePath: '/tmp/wt',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Skill config tests ───────────────────────────────────────────────────────

describe('dev-review-response skill.config', () => {
  it('has role developer', () => {
    expect(devReviewResponseConfig.role).toBe('developer');
  });

  it('includes devReviewFindings in contextAllowlist', () => {
    expect(devReviewResponseConfig.contextAllowlist).toContain('devReviewFindings');
  });

  it('does NOT have freshContext (dev-review-response is not a holdout)', () => {
    expect(devReviewResponseConfig.freshContext).toBe(false);
  });

  it('uses dev-tools bundle', () => {
    expect(devReviewResponseConfig.toolBundles).toContain('dev-tools');
  });
});
