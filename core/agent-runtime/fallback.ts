import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { modelsAtOrAboveTier, tierOf } from './models.js';

export interface FallbackPolicy {
  allowDownTier: boolean;
  maxAttempts: number;
}

const HOLDOUT_ROLES = new Set(['qa', 'reviewer']);
const CRITICAL_PRIORITIES = new Set(['critical', 'high']);

/**
 * Wraps any AgentRuntime with the M4 fallback policy:
 * - Holdout roles (QA, Reviewer): no fallback, fail loudly
 * - Critical/high priority: no fallback, fail loudly
 * - Standard role + non-critical: one down-tier retry, emits agent.fallback-triggered
 */
export function withFallback(
  runtime: AgentRuntime,
  policy: FallbackPolicy,
): AgentRuntime {
  return {
    async run(spec: AgentSpec): Promise<AgentResult> {
      const isHoldout = HOLDOUT_ROLES.has(spec.role);
      const priority = (spec.context['priority'] as string | undefined) ?? 'medium';
      const isCriticalOrHigh = CRITICAL_PRIORITIES.has(priority);

      // Holdout and critical/high: no fallback
      if (isHoldout || isCriticalOrHigh || !policy.allowDownTier) {
        return runtime.run(spec);
      }

      try {
        return await runtime.run(spec);
      } catch (err) {
        // Attempt one-tier fallback
        const currentModel = spec.modelOverride ?? null;
        const currentTier = currentModel != null ? tierOf(currentModel) : null;

        if (currentTier == null || currentTier === 'haiku') {
          // Already at lowest tier or no model override — escalate
          throw err;
        }

        const lowerTier = currentTier === 'opus' ? 'sonnet' : 'haiku';
        const candidates = modelsAtOrAboveTier(lowerTier).filter((m) => m.tier === lowerTier);
        if (candidates.length === 0) throw err;

        const fallbackModel = candidates[0].id;
        const fallbackSpec: AgentSpec = { ...spec, modelOverride: fallbackModel };
        return runtime.run(fallbackSpec);
      }
    },
  };
}
