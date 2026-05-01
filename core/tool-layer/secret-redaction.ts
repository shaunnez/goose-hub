/**
 * Pattern-based secret redaction for event payloads.
 * Deep-walks any JSON-compatible value and replaces matched secrets with [REDACTED].
 * Safe on non-string types — they pass through unchanged.
 */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactSecrets(v)]),
    );
  }
  return value;
}

function redactString(s: string): string {
  return s
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
    .replace(/gh[ps]_[A-Za-z0-9]{36,}/g, '[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]{82,}/g, '[REDACTED]')
    .replace(/Bearer [A-Za-z0-9._-]{20,}/g, '[REDACTED]')
    .replace(
      /(\b[A-Z][A-Z0-9_]*(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIAL)=)[^\s"']+/g,
      (_, prefix: string) => `${prefix}[REDACTED]`,
    );
}
