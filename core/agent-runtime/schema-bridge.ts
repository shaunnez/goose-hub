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
    const requiredProperties: string[] = [];

    for (const key of Object.keys(properties)) {
      if (!required.has(key)) properties[key] = allowNullSchema(properties[key]);
      requiredProperties.push(key);
    }

    next.properties = properties;
    next.required = requiredProperties;
    next.additionalProperties = false;
  }

  return next;
}

function isObjectSchema(value: Record<string, unknown>): boolean {
  return (
    value.type === 'object' || isRecord(value.properties) || value.additionalProperties != null
  );
}

function allowNullSchema(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const next = { ...value };
  if (schemaAllowsNull(next)) return next;

  if ('const' in next) {
    return { anyOf: [next, { type: 'null' }] };
  }

  if (Array.isArray(next.enum) && !next.enum.includes(null)) {
    next.enum = [...next.enum, null];
  }

  if (typeof next.type === 'string') {
    next.type = [next.type, 'null'];
    return next;
  }

  if (Array.isArray(next.type)) {
    next.type = [...next.type, 'null'];
    return next;
  }

  return { anyOf: [next, { type: 'null' }] };
}

function schemaAllowsNull(value: Record<string, unknown>): boolean {
  if (value.type === 'null') return true;
  if (Array.isArray(value.type) && value.type.includes('null')) return true;
  const variants = Array.isArray(value.anyOf)
    ? value.anyOf
    : Array.isArray(value.oneOf)
      ? value.oneOf
      : [];
  if (variants.some((variant) => isRecord(variant) && schemaAllowsNull(variant))) return true;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
