export function omitNullObjectProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullObjectProperties);
  if (!isRecord(value)) return value;

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null) continue;
    next[key] = omitNullObjectProperties(child);
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
