import type { ZodType } from 'zod';
import { safeParseOutputForSchema } from './output-normalization.js';

export class OutputValidationError extends Error {
  constructor(
    public readonly received: string,
    public readonly errors: unknown[],
  ) {
    super(`Output validation failed: ${JSON.stringify(errors)}`);
    this.name = 'OutputValidationError';
  }
}

/**
 * Validates raw JSON string from Claude CLI against a Zod schema.
 * Throws OutputValidationError on invalid JSON or schema mismatch.
 */
export function validateOutput<T>(raw: string, schema: ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OutputValidationError(raw, [`Invalid JSON: ${raw.slice(0, 200)}`]);
  }

  const result = safeParseOutputForSchema(schema, parsed);
  if (!result.success) {
    const errors = (result as { success: false; error: { issues: unknown[] } }).error.issues;
    throw new OutputValidationError(raw, errors);
  }

  return (result as { success: true; data: T }).data;
}
