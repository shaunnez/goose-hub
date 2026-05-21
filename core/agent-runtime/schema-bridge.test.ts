import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ImplementSchema } from '../../skills/implement/schema.js';
import { InterventionProposerOutputSchema } from '../../skills/intervention-proposer/schema.js';
import { ReviewOutputSchema } from '../../skills/review/schema.js';
import { TriageOutputSchema } from '../../skills/triage/schema.js';
import { PRDOutputSchema } from '../../skills/write-prd/schema.js';
import { toJsonSchema } from './schema-bridge.js';

describe('toJsonSchema', () => {
  it('converts a Zod schema to JSON Schema', () => {
    const schema = z.object({ name: z.string(), count: z.number() });
    const result = toJsonSchema(schema);
    expect(result).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['name', 'count'],
      additionalProperties: false,
    });
  });

  it('preserves optional object properties, marks them required, and allows null', () => {
    const schema = z.object({
      decisionSummaries: z.array(
        z.object({
          kind: z.string(),
          summary: z.string(),
          evidence: z.string().optional(),
        }),
      ),
    });

    const result = toJsonSchema(schema);
    const decisionSummaries = result.properties as Record<string, unknown>;
    const field = decisionSummaries.decisionSummaries as { items?: unknown };
    const item = field.items as { properties?: Record<string, unknown>; required?: string[] };

    expect(item.properties).toHaveProperty('evidence');
    expect(item.properties?.evidence).toEqual({ type: ['string', 'null'] });
    expect(item.required).toEqual(['kind', 'summary', 'evidence']);
  });

  it('allows null for nested optional decision summary evidence in triage output', () => {
    const result = toJsonSchema(TriageOutputSchema);
    const properties = result.properties as Record<string, unknown>;
    const decisionSummaries = properties.decisionSummaries as { items?: unknown };
    const item = decisionSummaries.items as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(item.properties?.evidence).toEqual({ type: ['string', 'null'] });
    expect(item.required).toEqual(['kind', 'summary', 'evidence']);
  });

  it('strips unsupported propertyNames keywords', () => {
    const schema = z.object({
      input: z.record(z.string(), z.unknown()),
    });

    const result = JSON.stringify(toJsonSchema(schema));

    expect(result).not.toContain('propertyNames');
  });

  it('strips uri string formats rejected by Codex response schemas', () => {
    const result = toJsonSchema(z.object({ prUrl: z.string().url() }));

    const properties = result.properties as Record<string, unknown>;
    const prUrl = properties.prUrl as Record<string, unknown>;

    expect(prUrl).toMatchObject({ type: 'string' });
    expect(prUrl).not.toHaveProperty('format');
  });

  it('replaces unconstrained schema nodes with an explicit JSON value type', () => {
    const result = toJsonSchema(z.object({ payload: z.unknown() }));

    const properties = result.properties as Record<string, unknown>;
    const payload = properties.payload as Record<string, unknown>;

    expect(payload).toEqual({
      type: ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'],
    });
  });

  it('allows null through optional enum schemas', () => {
    const result = toJsonSchema(z.object({ priority: z.enum(['p1', 'p2']).optional() }));
    const properties = result.properties as Record<string, unknown>;

    expect(properties.priority).toEqual({
      type: ['string', 'null'],
      enum: ['p1', 'p2', null],
    });
    expect(result.required).toEqual(['priority']);
  });

  it('keeps implement output schema acceptable for Codex response schemas', () => {
    const result = JSON.stringify(toJsonSchema(ImplementSchema));

    expect(result).not.toContain('"format":"uri"');
    expect(result).not.toContain('"format": "uri"');
  });

  it('preserves optional PRD output fields needed by write-prd validation', () => {
    const result = toJsonSchema(PRDOutputSchema);
    const properties = result.properties as Record<string, unknown>;

    const acceptanceCriteria = properties.acceptanceCriteria as { items?: unknown };
    const acceptanceCriterion = acceptanceCriteria.items as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(Object.keys(acceptanceCriterion.properties ?? {})).toEqual([
      'id',
      'statement',
      'journeyId',
      'stepIdx',
      'crossCutting',
      'verifyCommand',
    ]);
    expect(acceptanceCriterion.properties?.journeyId).toEqual({ type: ['string', 'null'] });
    expect(acceptanceCriterion.properties?.stepIdx).toMatchObject({ type: ['integer', 'null'] });
    expect(acceptanceCriterion.properties?.crossCutting).toEqual({ type: ['boolean', 'null'] });
    expect(acceptanceCriterion.properties?.verifyCommand).toEqual({ type: ['string', 'null'] });
    expect(acceptanceCriterion.required).toEqual([
      'id',
      'statement',
      'journeyId',
      'stepIdx',
      'crossCutting',
      'verifyCommand',
    ]);
    expect(acceptanceCriterion.additionalProperties).toBe(false);

    const implementationDecisions = properties.implementationDecisions as { items?: unknown };
    const implementationDecision = implementationDecisions.items as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(implementationDecision.properties).toHaveProperty('rationale');
    expect(implementationDecision.properties).toHaveProperty('moduleRef');
    expect(implementationDecision.properties?.rationale).toEqual({ type: ['string', 'null'] });
    expect(implementationDecision.properties?.moduleRef).toEqual({ type: ['string', 'null'] });
    expect(implementationDecision.required).toEqual(['decision', 'rationale', 'moduleRef']);

    const testingDecisions = properties.testingDecisions as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(testingDecisions.properties).toHaveProperty('priorArt');
    expect(testingDecisions.properties?.priorArt).toEqual({ type: ['string', 'null'] });
    expect(testingDecisions.required).toEqual(['approach', 'modulesToTest', 'priorArt']);
  });

  it('keeps intervention proposer output schema acceptable for Codex response schemas', () => {
    const result = toJsonSchema(InterventionProposerOutputSchema);
    const properties = result.properties as Record<string, unknown>;
    const options = properties.options as { items?: unknown };
    const item = options.items as { properties?: Record<string, unknown> };

    expect(item.properties?.payload).toEqual({
      type: ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'],
    });
    expect(JSON.stringify(result)).not.toContain('"payload":{}');
  });

  it('collapses top-level object unions into an object schema for Codex response formats', () => {
    const result = toJsonSchema(ReviewOutputSchema);

    expect(result.type).toBe('object');
    expect(result).not.toHaveProperty('oneOf');
    expect(result).toMatchObject({
      properties: {
        verdict: { type: 'string', enum: ['approved', 'needs-fix', 'needs-human'] },
        confidence: { type: 'number' },
        criteriaChecks: { type: 'array' },
        findings: { type: 'array' },
        decisionSummaries: { type: 'array' },
      },
      required: ['verdict', 'confidence', 'criteriaChecks', 'findings', 'decisionSummaries'],
      additionalProperties: false,
    });
  });

  it('returns an empty schema and warns when conversion throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A schema-shaped object that intentionally trips toJSONSchema by missing
    // the internal _zod metadata it relies on.
    const broken = {} as unknown as Parameters<typeof toJsonSchema>[0];

    const result = toJsonSchema(broken);

    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain('schema-bridge');

    warnSpy.mockRestore();
  });
});
