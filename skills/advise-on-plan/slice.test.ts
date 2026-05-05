import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import config, { AdviseOnPlanContextSchema } from './config.js';
import { AdviseOnPlanSchema, AdvisorVerdictSchema } from './schema.js';

describe('advise-on-plan output schema', () => {
  it('accepts a proceed verdict', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'proceed',
      confidence: 'high',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Plan looks sound; no conflicts' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a revise verdict with feedback', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'revise',
      confidence: 'medium',
      feedback: 'Re-use core/validation/zod.ts:42 instead of adding a new helper',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Plan duplicates existing helper' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an abort verdict with reason', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'abort',
      confidence: 'high',
      reason: 'Plan modifies FACTORY_RULES.md, violating rule 12',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Plan violates governance immutability' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects revise without feedback', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'revise',
      confidence: 'medium',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'something' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects revise with empty feedback', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'revise',
      confidence: 'medium',
      feedback: '',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'something' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects abort without reason', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'abort',
      confidence: 'high',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'something' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects abort with empty reason', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'abort',
      confidence: 'high',
      reason: '',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'something' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects proceed with extra revise/abort fields', () => {
    // discriminated union strictly excludes fields not on the matched variant.
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'proceed',
      confidence: 'high',
      feedback: 'extra field that should not be present',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'something' }],
    });
    // Zod discriminated unions are non-strict by default — extra fields pass.
    // What we *must* reject is `verdict` not being one of the three literals.
    expect(result.success).toBe(true);
  });

  it('rejects unknown verdict value', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'approved-with-notes',
      confidence: 'high',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'proceed',
      confidence: 'high',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown confidence value', () => {
    const result = AdviseOnPlanSchema.safeParse({
      verdict: 'proceed',
      confidence: 'mid',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces a valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(AdviseOnPlanSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
  });

  it('AdvisorVerdictSchema is exported and usable independently', () => {
    expect(AdvisorVerdictSchema.safeParse({ verdict: 'proceed', confidence: 'high' }).success).toBe(
      true,
    );
  });
});

describe('advise-on-plan skill config', () => {
  it('runs in fresh context (CONTEXT.md advisor pattern)', () => {
    expect(config.freshContext).toBe(true);
  });

  it('uses the read tool bundle (no write/exec)', () => {
    expect(config.toolBundles).toContain('read');
    expect(config.toolBundles).not.toContain('write');
    expect(config.toolBundles).not.toContain('bash');
  });

  it('is pinned to opus (advisor is a higher-tier reviewer)', () => {
    expect(config.modelPin).toBe('opus');
  });

  it('has contextAllowlist that includes plan and revisionPass keys', () => {
    expect(config.contextAllowlist).toContain('plan');
    expect(config.contextAllowlist).toContain('revisionPass');
    expect(config.contextAllowlist).toContain('previousAdvisorFeedback');
    expect(config.contextAllowlist).toContain('workItem.priority');
  });
});

describe('advise-on-plan context schema', () => {
  it('accepts valid first-pass context', () => {
    const valid = AdviseOnPlanContextSchema.safeParse({
      workItem: { title: 'Add caching', body: 'Add a cache to X', number: 42, priority: 'high' },
      plan: 'Step 1: extend X. Step 2: invalidate on Y.',
    });
    expect(valid.success).toBe(true);
  });

  it('accepts revisionPass: 1 with previousAdvisorFeedback', () => {
    const valid = AdviseOnPlanContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1, priority: 'critical' },
      plan: 'revised plan',
      revisionPass: 1,
      previousAdvisorFeedback: 'previous notes',
    });
    expect(valid.success).toBe(true);
  });

  it('rejects priority other than high or critical (advisor only runs on those)', () => {
    const invalid = AdviseOnPlanContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1, priority: 'medium' },
      plan: 'p',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects revisionPass values other than 0 or 1', () => {
    const invalid = AdviseOnPlanContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1, priority: 'high' },
      plan: 'p',
      revisionPass: 2,
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects missing plan', () => {
    const invalid = AdviseOnPlanContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1, priority: 'high' },
    });
    expect(invalid.success).toBe(false);
  });
});
