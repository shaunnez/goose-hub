import { describe, expect, it } from 'vitest';
import {
  ProviderErrorKindSchema,
  mapHttpStatusToProviderErrorKind,
  providerFailure,
} from './errors.js';

describe('Atlassian provider errors', () => {
  it('covers the provider error kinds callers need to branch on', () => {
    expect(ProviderErrorKindSchema.options).toEqual([
      'validation',
      'auth',
      'permission',
      'not_found',
      'query',
      'rate_limit',
      'connection',
      'post_back',
    ]);
  });

  it('maps HTTP provider failures into typed result variants', () => {
    expect(mapHttpStatusToProviderErrorKind(400)).toBe('query');
    expect(mapHttpStatusToProviderErrorKind(401)).toBe('auth');
    expect(mapHttpStatusToProviderErrorKind(403)).toBe('permission');
    expect(mapHttpStatusToProviderErrorKind(404)).toBe('not_found');
    expect(mapHttpStatusToProviderErrorKind(429)).toBe('rate_limit');
    expect(mapHttpStatusToProviderErrorKind(503)).toBe('connection');
    expect(mapHttpStatusToProviderErrorKind(403, 'post_back')).toBe('post_back');
  });

  it('returns provider errors as result variants', () => {
    expect(providerFailure('not_found', 'Jira issue not found', { status: 404 })).toEqual({
      ok: false,
      error: {
        kind: 'not_found',
        message: 'Jira issue not found',
        status: 404,
      },
    });
  });
});
