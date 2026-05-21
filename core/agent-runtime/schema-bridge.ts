import { toJSONSchema } from 'zod';
import type { ZodType } from 'zod';

export type JsonSchema = Record<string, unknown>;

const ANY_JSON_VALUE_SCHEMA: JsonSchema = {
  type: ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'],
};

const UNSUPPORTED_CODEX_FORMATS = new Set(['uri']);

export function toJsonSchema(schema: ZodType): JsonSchema {
  try {
    return toCodexResponseSchema(toJSONSchema(schema) as JsonSchema);
  } catch (err) {
    console.warn(
      '[schema-bridge] toJSONSchema conversion failed, falling back to empty schema:',
      err,
    );
    return {};
  }
}

function toCodexResponseSchema(schema: JsonSchema): JsonSchema {
  return sanitizeSchemaNode(schema) as JsonSchema;
}

function sanitizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchemaNode);
  if (!isRecord(value)) return value;

  if (Object.keys(value).length === 0) return { ...ANY_JSON_VALUE_SCHEMA };

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'propertyNames') continue;
    if (key === 'format' && typeof child === 'string' && UNSUPPORTED_CODEX_FORMATS.has(child)) {
      continue;
    }
    next[key] = sanitizeSchemaNode(child);
  }

  if (isObjectSchema(next)) {
    const properties = isRecord(next.properties) ? next.properties : {};
    const required = new Set(
      Array.isArray(next.required) ? next.required.filter((key) => typeof key === 'string') : [],
    );
    const strictProperties: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(properties)) {
      if (required.has(key)) strictProperties[key] = child;
    }

    next.properties = strictProperties;
    next.required = Object.keys(strictProperties);
    next.additionalProperties = false;
  }

  return next;
}

function isObjectSchema(value: Record<string, unknown>): boolean {
  return (
    value.type === 'object' || isRecord(value.properties) || value.additionalProperties != null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
