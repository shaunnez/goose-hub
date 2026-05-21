import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ImplementSchema } from '../../skills/implement/schema.js';
import { InterventionProposerOutputSchema } from '../../skills/intervention-proposer/schema.js';
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

  it('removes optional properties from the runtime schema', () => {
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

    expect(item.properties).not.toHaveProperty('evidence');
    expect(item.required).toEqual(['kind', 'summary']);
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

  it('keeps implement output schema acceptable for Codex response schemas', () => {
    const result = JSON.stringify(toJsonSchema(ImplementSchema));

    expect(result).not.toContain('"format":"uri"');
    expect(result).not.toContain('"format": "uri"');
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
