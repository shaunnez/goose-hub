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
  return normalizeTopLevelResponseSchema(sanitizeSchemaNode(schema)) as JsonSchema;
}

function normalizeTopLevelResponseSchema(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const variants = getObjectUnionVariants(value);
  if (variants == null) return value;

  const firstRequired = requiredKeys(variants[0]);
  const commonRequired = firstRequired.filter((key) =>
    variants.every((variant) => requiredKeys(variant).includes(key)),
  );
  const propertiesByVariant = variants.map((variant) =>
    isRecord(variant.properties) ? variant.properties : {},
  );
  const properties: Record<string, unknown> = {};

  for (const key of commonRequired) {
    const schemas = propertiesByVariant.map((variantProperties) => variantProperties[key]);
    if (schemas.every(isRecord)) properties[key] = mergeCommonPropertySchemas(schemas);
  }

  const { oneOf: _oneOf, anyOf: _anyOf, ...base } = value;
  return {
    ...base,
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function getObjectUnionVariants(value: Record<string, unknown>): Record<string, unknown>[] | null {
  const union = Array.isArray(value.oneOf)
    ? value.oneOf
    : Array.isArray(value.anyOf)
      ? value.anyOf
      : null;
  if (union == null || union.length === 0) return null;
  if (!union.every(isRecord)) return null;

  const variants = union as Record<string, unknown>[];
  return variants.every((variant) => variant.type === 'object' && isRecord(variant.properties))
    ? variants
    : null;
}

function requiredKeys(value: Record<string, unknown>): string[] {
  return Array.isArray(value.required)
    ? value.required.filter((key): key is string => typeof key === 'string')
    : [];
}

function mergeCommonPropertySchemas(schemas: Record<string, unknown>[]): unknown {
  const [first] = schemas;
  if (first == null) return {};
  if (schemas.every((schema) => JSON.stringify(schema) === JSON.stringify(first))) return first;

  const constValues = schemas.map((schema) => schema.const);
  if (constValues.every((value) => typeof value === 'string')) {
    return {
      type: 'string',
      enum: [...new Set(constValues as string[])],
    };
  }

  return first;
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
