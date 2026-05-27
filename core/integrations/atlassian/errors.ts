import { z } from 'zod';

export const ProviderErrorKindSchema = z.enum([
  'validation',
  'auth',
  'permission',
  'not_found',
  'query',
  'rate_limit',
  'connection',
  'post_back',
]);

export const ProviderErrorSchema = z
  .object({
    kind: ProviderErrorKindSchema,
    message: z.string().min(1),
    status: z.number().int().positive().optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
  })
  .strict();

export type ProviderErrorKind = z.infer<typeof ProviderErrorKindSchema>;
export type ProviderError = z.infer<typeof ProviderErrorSchema>;
export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ProviderError };

export function providerError(
  kind: ProviderErrorKind,
  message: string,
  options: Omit<ProviderError, 'kind' | 'message'> = {},
): ProviderError {
  return ProviderErrorSchema.parse({
    kind,
    message,
    ...options,
  });
}

export function providerFailure(
  kind: ProviderErrorKind,
  message: string,
  options: Omit<ProviderError, 'kind' | 'message'> = {},
): ProviderResult<never> {
  return {
    ok: false,
    error: providerError(kind, message, options),
  };
}

export function mapHttpStatusToProviderErrorKind(
  status: number,
  operation?: 'read' | 'query' | 'post_back',
): ProviderErrorKind {
  if (operation === 'post_back') return 'post_back';
  if (status === 400) return 'query';
  if (status === 401) return 'auth';
  if (status === 403) return 'permission';
  if (status === 404) return 'not_found';
  if (status === 408 || status >= 500) return 'connection';
  if (status === 429) return 'rate_limit';
  return 'connection';
}
