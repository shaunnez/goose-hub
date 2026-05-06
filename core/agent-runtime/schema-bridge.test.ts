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
