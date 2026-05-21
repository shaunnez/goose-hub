import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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
