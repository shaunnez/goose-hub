import { describe, expect, it } from 'vitest';
import { costFromApiUsage, costFromCliEnvelope } from './extract.js';

describe('costFromCliEnvelope', () => {
  it('returns null for non-object input', () => {
    expect(costFromCliEnvelope(null)).toBeNull();
    expect(costFromCliEnvelope(undefined)).toBeNull();
    expect(costFromCliEnvelope('string')).toBeNull();
  });

  it('returns null when no recognisable cost or token fields are present', () => {
    expect(costFromCliEnvelope({ result: 'hi' })).toBeNull();
    expect(costFromCliEnvelope({ usage: {} })).toBeNull();
  });

  it('extracts total_cost_usd and usage tokens from a CLI envelope', () => {
    const envelope = {
      result: '{"ok":true}',
      total_cost_usd: 0.0421,
      usage: { input_tokens: 1234, output_tokens: 567 },
    };
    expect(costFromCliEnvelope(envelope)).toEqual({
      inputTokens: 1234,
      outputTokens: 567,
      costUsd: 0.0421,
      costLabel: 'estimated',
    });
  });

  it('handles snake_case and camelCase token fields', () => {
    const envelope = {
      cost_usd: 0.1,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
    expect(costFromCliEnvelope(envelope)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.1,
      costLabel: 'estimated',
    });
  });

  it('returns zeros for missing token fields when only cost is present', () => {
    expect(costFromCliEnvelope({ cost: 0.5 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.5,
      costLabel: 'estimated',
    });
  });

  it('returns costUsd:0 (not null) when tokens are present but no cost field exists', () => {
    // Load-bearing behavior: callers that need to detect "no explicit cost" must check
    // the CodexEnvelope.usage.costUsd (number|null), not this return value.
    const envelope = { usage: { input_tokens: 500, output_tokens: 200 } };
    expect(costFromCliEnvelope(envelope)).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0,
      costLabel: 'estimated',
    });
  });
});

describe('costFromApiUsage', () => {
  it('always tags exact', () => {
    expect(costFromApiUsage({ inputTokens: 1, outputTokens: 2, costUsd: 0.003 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0.003,
      costLabel: 'exact',
    });
  });
});
