import type { ModelProvider, ModelTier } from '../types.js';

export type { ModelProvider, ModelTier };

export interface ModelEntry {
  id: string;
  tier: ModelTier;
  /** Provider that executes this model. Defaults to 'claude' when absent. */
  provider?: ModelProvider;
  deprecated?: boolean;
  /** Published per-1M-token rates (USD). Missing means no pricing data; estimateCostUsd returns 0. */
  pricing?: { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number };
}

export const MODELS: ModelEntry[] = [
  {
    id: 'claude-opus-4-7',
    tier: 'opus',
    provider: 'claude',
    pricing: { inputPer1M: 15.0, cachedInputPer1M: 1.5, outputPer1M: 75.0 },
  },
  {
    id: 'claude-sonnet-4-6',
    tier: 'sonnet',
    provider: 'claude',
    pricing: { inputPer1M: 3.0, cachedInputPer1M: 0.3, outputPer1M: 15.0 },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    tier: 'haiku',
    provider: 'claude',
    pricing: { inputPer1M: 0.8, cachedInputPer1M: 0.08, outputPer1M: 4.0 },
  },
  {
    id: 'gpt-5.5',
    tier: 'opus',
    provider: 'codex',
    pricing: { inputPer1M: 5.0, cachedInputPer1M: 1.25, outputPer1M: 30.0 },
  },
  {
    id: 'gpt-5.4',
    tier: 'sonnet',
    provider: 'codex',
    pricing: { inputPer1M: 2.5, cachedInputPer1M: 0.625, outputPer1M: 15.0 },
  },
  {
    id: 'gpt-5.4-mini',
    tier: 'haiku',
    provider: 'codex',
    pricing: { inputPer1M: 0.75, cachedInputPer1M: 0.1875, outputPer1M: 4.5 },
  },
];

const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus'];

export function defaultModelForTier(tier: ModelTier): string {
  const entry = MODELS.find(
    (m) => m.tier === tier && !m.deprecated && (m.provider ?? 'claude') === 'claude',
  );
  if (!entry) throw new Error(`No non-deprecated model found for tier: ${tier}`);
  return entry.id;
}

export function defaultModelForTierAndProvider(tier: ModelTier, provider: ModelProvider): string {
  const entry = MODELS.find(
    (m) => m.tier === tier && !m.deprecated && (m.provider ?? 'claude') === provider,
  );
  if (!entry) {
    throw new Error(`No non-deprecated ${provider} model found for tier: ${tier}`);
  }
  return entry.id;
}

export function providerOf(modelId: string): ModelProvider {
  const entry = MODELS.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown model ID: ${modelId}`);
  return entry.provider ?? 'claude';
}

/** Safe variant — returns 'claude' for unknown model IDs. Never throws.
 * Use in cost reporting paths that touch historical DB rows with unrecognised model IDs. */
export function tryProviderOf(modelId: string): ModelProvider {
  return MODELS.find((m) => m.id === modelId)?.provider ?? 'claude';
}

/** Estimates cost in USD from token counts using published per-1M-token rates.
 * Returns 0 when the model has no pricing entry or tokens are zero. Never throws. */
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  opts: { cachedInputTokens?: number; reasoningOutputTokens?: number } = {},
): number {
  const pricing = MODELS.find((m) => m.id === modelId)?.pricing;
  if (!pricing) return 0;
  const cached = Math.min(opts.cachedInputTokens ?? 0, inputTokens);
  const uncachedInput = inputTokens - cached;
  const totalOutput = outputTokens + (opts.reasoningOutputTokens ?? 0);
  return (
    (uncachedInput / 1_000_000) * pricing.inputPer1M +
    (cached / 1_000_000) * pricing.cachedInputPer1M +
    (totalOutput / 1_000_000) * pricing.outputPer1M
  );
}

export function tierOf(modelId: string): ModelTier {
  const entry = MODELS.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown model ID: ${modelId}`);
  return entry.tier;
}

export function modelsAtOrAboveTier(
  tier: ModelTier,
  provider: ModelProvider = 'claude',
): ModelEntry[] {
  const minIndex = TIER_ORDER.indexOf(tier);
  return MODELS.filter(
    (m) =>
      !m.deprecated &&
      TIER_ORDER.indexOf(m.tier) >= minIndex &&
      (m.provider ?? 'claude') === provider,
  );
}
