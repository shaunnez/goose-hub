import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ImplementSchema } from '../../skills/implement/schema.js';
import { DecisionSummarySchema } from '../retrospective/schemas.js';
import { normalizeOutputForSchema, safeParseOutputForSchema } from './output-normalization.js';
import { ScoutOutputSchema } from './scout-output.js';

describe('normalizeOutputForSchema', () => {
  it('omits null for optional string fields', () => {
    const schema = z.object({ value: z.string().optional() });

    expect(normalizeOutputForSchema(schema, { value: null })).toEqual({});
  });

  it('preserves null for required nullable string fields', () => {
    const schema = z.object({ value: z.string().nullable() });

    expect(normalizeOutputForSchema(schema, { value: null })).toEqual({ value: null });
  });

  it('omits null for optional nullable string fields by repo convention', () => {
    const schema = z.object({ value: z.string().nullable().optional() });

    expect(normalizeOutputForSchema(schema, { value: null })).toEqual({});
  });

  it('preserves null for required non-nullable fields so Zod rejects them', () => {
    const schema = z.object({ value: z.string() });
    const normalized = normalizeOutputForSchema(schema, { value: null });

    expect(normalized).toEqual({ value: null });
    expect(safeParseOutputForSchema(schema, { value: null }).success).toBe(false);
  });

  it('normalizes nested object optional fields without dropping required nullable fields', () => {
    const schema = z.object({
      nested: z.object({
        optional: z.string().optional(),
        requiredNullable: z.string().nullable(),
      }),
    });

    expect(
      normalizeOutputForSchema(schema, {
        nested: { optional: null, requiredNullable: null },
      }),
    ).toEqual({ nested: { requiredNullable: null } });
  });

  it('normalizes arrays of objects item by item', () => {
    const schema = z.object({
      items: z.array(z.object({ optional: z.string().optional(), required: z.string() })),
    });

    expect(
      normalizeOutputForSchema(schema, {
        items: [
          { optional: null, required: 'a' },
          { optional: 'kept', required: 'b' },
        ],
      }),
    ).toEqual({
      items: [{ required: 'a' }, { optional: 'kept', required: 'b' }],
    });
  });

  it('preserves unknown non-null object keys and omits unknown null keys', () => {
    const schema = z.object({ known: z.string() });

    expect(
      normalizeOutputForSchema(schema, {
        known: 'x',
        extra: { keep: 'y', drop: null },
        nullExtra: null,
      }),
    ).toEqual({ known: 'x', extra: { keep: 'y' } });
  });

  it('omits QA/scout-style optional nullable line values', () => {
    const parsed = safeParseOutputForSchema(ScoutOutputSchema, {
      status: 'ok',
      findings: [
        { file: 'core/db/schema.ts', line: null, fact: 'uses sqlite', confidence: 'high' },
      ],
      decisionSummaries: [{ kind: 'READ', summary: 'inspected core/db/schema.ts' }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.findings[0]).not.toHaveProperty('line');
  });

  it('keeps implement required nullable evidenceSpecPath null through validation', () => {
    const parsed = safeParseOutputForSchema(ImplementSchema, {
      plan: 'Backend-only fix',
      filesWritten: [
        { path: 'core/agent-runtime/output-normalization.ts', reason: 'Added helper' },
      ],
      testsWritten: [],
      testsRun: {
        command: 'pnpm vitest run core/agent-runtime/output-normalization.test.ts',
        paths: [],
      },
      prUrl: 'https://github.com/shaunnez/goose-hub/pull/1',
      evidenceSpecPath: null,
      confidence: 'high',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Backend-only validation change' }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.evidenceSpecPath).toBeNull();
  });

  it('omits optional decision summary evidence null values', () => {
    const schema = z.object({ decisionSummaries: z.array(DecisionSummarySchema) });
    const parsed = safeParseOutputForSchema(schema, {
      decisionSummaries: [{ kind: 'PLAN', summary: 'classified item', evidence: null }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.decisionSummaries[0]).not.toHaveProperty('evidence');
  });
});
