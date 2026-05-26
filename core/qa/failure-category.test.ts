import { describe, expect, it } from 'vitest';
import { classifyQaFailure } from './failure-category.js';

describe('classifyQaFailure', () => {
  it('prioritizes actionable product findings over structural or functional tier fallback', () => {
    expect(
      classifyQaFailure({
        failedTier: 'functional',
        hasActionableFinding: true,
      }),
    ).toBe('product');
  });

  it('keeps failed executable checks in the spec-contract category when no product finding exists', () => {
    expect(classifyQaFailure({ hasFailedExecutableCheck: true })).toBe('spec-contract');
  });

  it('keeps verification infrastructure distinct from product and spec failures', () => {
    expect(classifyQaFailure({ failedTier: 'functional', verificationInfrastructure: true })).toBe(
      'verification-infrastructure',
    );
  });
});
