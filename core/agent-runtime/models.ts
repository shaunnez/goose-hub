import type { ModelTier } from '../types.js';

export type { ModelTier };

export interface ModelEntry {
  id: string;
  tier: ModelTier;
  deprecated?: boolean;
}

export const MODELS: ModelEntry[] = [
  { id: 'claude-opus-4-7', tier: 'opus' },
  { id: 'claude-sonnet-4-6', tier: 'sonnet' },
  { id: 'claude-haiku-4-5-20251001', tier: 'haiku' },
];

const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus'];

export function defaultModelForTier(tier: ModelTier): string {
  const entry = MODELS.find((m) => m.tier === tier && !m.deprecated);
  if (!entry) throw new Error(`No non-deprecated model found for tier: ${tier}`);
  return entry.id;
}

export function tierOf(modelId: string): ModelTier {
  const entry = MODELS.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown model ID: ${modelId}`);
  return entry.tier;
}

export function modelsAtOrAboveTier(tier: ModelTier): ModelEntry[] {
  const minIndex = TIER_ORDER.indexOf(tier);
  return MODELS.filter((m) => !m.deprecated && TIER_ORDER.indexOf(m.tier) >= minIndex);
}
