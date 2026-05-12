import { describe, expect, it } from 'vitest';
import { estimateCostUsd, tryProviderOf } from './models.js';

describe('estimateCostUsd', () => {
  it('computes cost for a known codex model', () => {
    // gpt-5.4: inputPer1M=2.50, outputPer1M=15.00
    // 1_000_000 input + 1_000_000 output = $2.50 + $15.00 = $17.50
    expect(estimateCostUsd('gpt-5.4', 1_000_000, 1_000_000)).toBeCloseTo(17.5, 5);
  });

  it('computes cost for a known claude model', () => {
    // claude-sonnet-4-6: inputPer1M=3.00, outputPer1M=15.00
    // 500_000 input + 200_000 output = $1.50 + $3.00 = $4.50
    expect(estimateCostUsd('claude-sonnet-4-6', 500_000, 200_000)).toBeCloseTo(4.5, 5);
  });

  it('returns 0 for unknown model IDs without throwing', () => {
    expect(estimateCostUsd('some-future-model', 100_000, 50_000)).toBe(0);
  });

  it('returns 0 when tokens are zero', () => {
    expect(estimateCostUsd('gpt-5.4', 0, 0)).toBe(0);
  });

  it('handles fractional token counts correctly', () => {
    // gpt-5.4-mini: inputPer1M=0.75, outputPer1M=4.50
    // 100 input tokens = 100/1_000_000 * 0.75 = 0.000075
    const result = estimateCostUsd('gpt-5.4-mini', 100, 0);
    expect(result).toBeCloseTo(0.000075, 8);
  });
});

describe('tryProviderOf', () => {
  it('returns codex for known codex model IDs', () => {
    expect(tryProviderOf('gpt-5.4')).toBe('codex');
    expect(tryProviderOf('gpt-5.5')).toBe('codex');
    expect(tryProviderOf('gpt-5.4-mini')).toBe('codex');
  });

  it('returns claude for known claude model IDs', () => {
    expect(tryProviderOf('claude-sonnet-4-6')).toBe('claude');
    expect(tryProviderOf('claude-opus-4-7')).toBe('claude');
    expect(tryProviderOf('claude-haiku-4-5-20251001')).toBe('claude');
  });

  it('returns claude for unknown model IDs without throwing', () => {
    expect(tryProviderOf('unknown-model-xyz')).toBe('claude');
    expect(tryProviderOf('')).toBe('claude');
  });
});
