import { type ZodType, toJSONSchema } from 'zod';

type JsonSchema = Record<string, unknown>;

export function normalizeOutputForSchema(schema: ZodType, output: unknown): unknown {
  return normalizeValue(toJSONSchema(schema) as JsonSchema, output);
}

export function safeParseOutputForSchema<T>(schema: ZodType<T>, output: unknown) {
  return schema.safeParse(normalizeOutputForSchema(schema, output));
}

function normalizeValue(schema: unknown, value: unknown): unknown {
  const effectiveSchema = selectEffectiveSchema(schema, value);
  if (Array.isArray(value)) return normalizeArray(effectiveSchema, value);
  if (!isRecord(value)) return value;
  if (!isRecord(effectiveSchema) || !isObjectSchema(effectiveSchema)) {
    return normalizeUnknownObject(value);
  }

  const properties = isRecord(effectiveSchema.properties) ? effectiveSchema.properties : {};
  const required = new Set(requiredKeys(effectiveSchema));
  const next: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (Object.hasOwn(properties, key)) {
      if (child === null && !required.has(key)) continue;
      next[key] = normalizeValue(properties[key], child);
      continue;
    }

    if (child === null) continue;
    next[key] = normalizeValue(undefined, child);
  }

  return next;
}

function normalizeArray(schema: unknown, value: unknown[]): unknown[] {
  const itemSchema = isRecord(schema) ? schema.items : undefined;
  return value.map((item) => normalizeValue(itemSchema, item));
}

function normalizeUnknownObject(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null) continue;
    next[key] = normalizeValue(undefined, child);
  }
  return next;
}

function selectEffectiveSchema(schema: unknown, value: unknown): unknown {
  if (!isRecord(schema)) return schema;

  const variants = getSchemaVariants(schema);
  if (variants.length === 0) return schema;

  const nonNullVariants = variants.filter((variant) => !isNullSchema(variant));
  if (nonNullVariants.length === 0) return schema;

  if (Array.isArray(value)) {
    return nonNullVariants.find((variant) => isRecord(variant) && isArraySchema(variant)) ?? schema;
  }
  if (isRecord(value)) {
    return (
      nonNullVariants.find((variant) => isRecord(variant) && isObjectSchema(variant)) ?? schema
    );
  }

  return nonNullVariants[0] ?? schema;
}

function getSchemaVariants(schema: Record<string, unknown>): unknown[] {
  if (Array.isArray(schema.anyOf)) return schema.anyOf;
  if (Array.isArray(schema.oneOf)) return schema.oneOf;
  if (Array.isArray(schema.allOf)) return schema.allOf;
  return [];
}

function isObjectSchema(schema: Record<string, unknown>): boolean {
  return schema.type === 'object' || isRecord(schema.properties);
}

function isArraySchema(schema: Record<string, unknown>): boolean {
  return schema.type === 'array' || schema.items != null;
}

function isNullSchema(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.type === 'null') return true;
  return Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'null';
}

function requiredKeys(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
