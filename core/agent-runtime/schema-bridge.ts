import { toJSONSchema } from 'zod';
import type { ZodType } from 'zod';

export type JsonSchema = Record<string, unknown>;

export function toJsonSchema(schema: ZodType): JsonSchema {
  try {
    return toJSONSchema(schema) as JsonSchema;
  } catch (err) {
    console.warn(
      '[schema-bridge] toJSONSchema conversion failed, falling back to empty schema:',
      err,
    );
    return {};
  }
}
