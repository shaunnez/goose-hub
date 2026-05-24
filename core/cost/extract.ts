import type { CostUsage } from './types.js';

/**
 * Extracts token usage and cost from a Claude CLI `--output-format json`
 * envelope. The CLI's envelope for a successful run includes summary fields
 * like `total_cost_usd`, `usage`, and `num_turns` (alongside `result`).
 *
 * We treat this as `'estimated'` because the CLI's number is a rollup the CLI
 * computed itself; direct API integrations (when added) can supply `'exact'`
 * usage metadata via {@link costFromApiUsage}.
 *
 * Returns `null` when no recognisable usage/cost fields are present — callers
 * fall back to a conservative zero-cost stub so a cost row is still written
 * (we never lose the run from the dashboard).
 */
export function costFromCliEnvelope(envelope: unknown): CostUsage | null {
  if (envelope == null || typeof envelope !== 'object') return null;
  const env = envelope as Record<string, unknown>;

  const cost = numericField(env, ['total_cost_usd', 'cost_usd', 'cost']);
  const usage = (env.usage ?? {}) as Record<string, unknown>;
  const inputTokens = numericField(usage, ['input_tokens', 'inputTokens', 'prompt_tokens']) ?? 0;
  const outputTokens =
    numericField(usage, ['output_tokens', 'outputTokens', 'completion_tokens']) ?? 0;
  const cachedInputTokens =
    numericField(usage, ['cached_input_tokens', 'cachedInputTokens']) ??
    numericField((usage.prompt_tokens_details ?? {}) as Record<string, unknown>, ['cached_tokens']) ??
    0;
  const reasoningOutputTokens =
    numericField(usage, ['reasoning_output_tokens', 'reasoningOutputTokens']) ??
    numericField((usage.completion_tokens_details ?? {}) as Record<string, unknown>, [
      'reasoning_tokens',
    ]) ??
    0;

  if (cost == null && inputTokens === 0 && outputTokens === 0) return null;

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
    costUsd: cost ?? 0,
    costLabel: 'estimated',
  };
}

/**
 * Builds an exact `CostUsage` from authoritative API usage metadata. Called
 * from any future code path that talks to the Anthropic SDK directly and
 * therefore has trusted token counts and a derived dollar figure.
 */
export function costFromApiUsage(input: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
  costUsd: number;
}): CostUsage {
  return {
    ...input,
    cachedInputTokens: input.cachedInputTokens ?? 0,
    reasoningOutputTokens: input.reasoningOutputTokens ?? 0,
    costLabel: 'exact',
  };
}

function numericField(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
