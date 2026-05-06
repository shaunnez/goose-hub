import type { ModelTier } from '../types.js';
import type { AgentBudgets } from './interface.js';
import { defaultModelForTier } from './models.js';

export interface SkillBudget {
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
  modelTier: ModelTier;
  /**
   * Escalation policy for schema-validation failures. When present,
   * `runWithEscalation` may retry once at the escalated tier with the
   * supplied budget. Sonnet costs ~10× haiku per token, so escalated
   * `maxBudgetUsd` should be sized accordingly — reuse of the base haiku
   * budget would risk hitting the cap mid-run.
   *
   * Only set this on skills where retry is worth the cost (`implement`).
   * Triage / repo-match / evidence-post fail loudly instead — the savings
   * there don't justify the complexity.
   */
  escalation?: {
    modelTier: ModelTier;
    maxBudgetUsd: number;
    maxTurns?: number;
    timeoutMs?: number;
  };
}

export type SkillBudgetOverride = Partial<SkillBudget>;

/**
 * Canonical per-skill budget defaults. Derived from observed run telemetry
 * with a 3-5× safety margin. modelTier drives the starting model; workflows
 * may escalate to a higher tier on schema-validation failure (future).
 *
 * Numbers sourced from actual runs — not guesses:
 *   triage: 39s, <10 turns, $0.0003
 *   repo-match: 10s, <10 turns, $0.0003
 *   evidence-post: 3min, 17 turns, $0.53
 *   implement: 6min, 45 turns, $1.61  (simple feature)
 *   qa: 3.5min, 29 turns, $0.66
 *   review: 35s, <10 turns, $0.09
 *   retro-light: 34s, <10 turns, $0.06
 *   retro-deep: 1.5min, <10 turns, $0.11
 */
export const SKILL_BUDGETS: Record<string, SkillBudget> = {
  triage: { maxTurns: 25, maxBudgetUsd: 0.05, timeoutMs: 120_000, modelTier: 'haiku' },
  'repo-match': { maxTurns: 25, maxBudgetUsd: 0.05, timeoutMs: 60_000, modelTier: 'haiku' },
  'bug-enhance': { maxTurns: 20, maxBudgetUsd: 0.3, timeoutMs: 120_000, modelTier: 'haiku' },
  'evidence-post': { maxTurns: 60, maxBudgetUsd: 2.0, timeoutMs: 300_000, modelTier: 'haiku' },
  implement: {
    maxTurns: 150,
    maxBudgetUsd: 6.0,
    timeoutMs: 900_000,
    modelTier: 'haiku',
    // Sonnet retry: ~2.5× haiku cap to absorb the per-token price delta on
    // a comparable turn count. Keep maxTurns/timeoutMs from the base.
    escalation: { modelTier: 'sonnet', maxBudgetUsd: 15.0 },
  },
  qa: { maxTurns: 100, maxBudgetUsd: 3.0, timeoutMs: 600_000, modelTier: 'sonnet' },
  review: { maxTurns: 25, maxBudgetUsd: 0.5, timeoutMs: 180_000, modelTier: 'sonnet' },
  'resolve-conflict': { maxTurns: 75, maxBudgetUsd: 4.0, timeoutMs: 600_000, modelTier: 'sonnet' },
  investigate: { maxTurns: 75, maxBudgetUsd: 4.0, timeoutMs: 600_000, modelTier: 'opus' },
  'playwright-repro': { maxTurns: 60, maxBudgetUsd: 3.0, timeoutMs: 600_000, modelTier: 'sonnet' },
  'advise-on-plan': { maxTurns: 15, maxBudgetUsd: 1.5, timeoutMs: 180_000, modelTier: 'opus' },
  'spec-author': { maxTurns: 50, maxBudgetUsd: 2.0, timeoutMs: 300_000, modelTier: 'sonnet' },
  'retrospective-light': {
    maxTurns: 25,
    maxBudgetUsd: 0.3,
    timeoutMs: 180_000,
    modelTier: 'haiku',
  },
  'retrospective-deep': {
    maxTurns: 30,
    maxBudgetUsd: 0.5,
    timeoutMs: 300_000,
    modelTier: 'sonnet',
  },
};

export interface ResolvedBudget {
  budgets: AgentBudgets;
  /** Resolved model ID — maps directly to AgentSpec.modelOverride. */
  modelOverride: string;
}

/**
 * Resolves the effective budget and starting model for a skill.
 *
 * Resolution order:
 *   1. Project-level override (budgets.skillBudgetOverrides[skill])
 *   2. Built-in SKILL_BUDGETS default
 *
 * maxBudgetUsd is capped at perWorkflowMaxUsd when projectBudgets is provided.
 *
 * Throws if the skill is not registered and no project override exists.
 */
export function resolveBudgets(
  skill: string,
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
  },
): ResolvedBudget {
  const base = SKILL_BUDGETS[skill];
  const override = projectBudgets?.skillBudgetOverrides?.[skill];

  if (base == null && override == null) {
    throw new Error(
      `resolveBudgets: no budget registered for skill '${skill}'. Add it to SKILL_BUDGETS in core/agent-runtime/budgets.ts or add a skillBudgetOverrides entry in the project config.`,
    );
  }

  const merged: SkillBudget = {
    ...(base ?? {
      maxTurns: 10,
      maxBudgetUsd: 1,
      timeoutMs: 120_000,
      modelTier: 'sonnet' as ModelTier,
    }),
    ...override,
  };

  let maxBudgetUsd = merged.maxBudgetUsd;
  if (
    projectBudgets?.perWorkflowMaxUsd != null &&
    maxBudgetUsd > projectBudgets.perWorkflowMaxUsd
  ) {
    maxBudgetUsd = projectBudgets.perWorkflowMaxUsd;
  }

  return {
    budgets: { maxTurns: merged.maxTurns, maxBudgetUsd, timeoutMs: merged.timeoutMs },
    modelOverride: defaultModelForTier(merged.modelTier),
  };
}

/**
 * Resolves the escalated budget for a skill — used by `runWithEscalation` to
 * retry once at a higher tier when the haiku output fails schema validation.
 *
 * Returns `null` when the skill has no escalation policy (most skills don't);
 * the caller must then surface the validation error.
 *
 * `maxTurns` and `timeoutMs` default to the base entry's values; `maxBudgetUsd`
 * comes from the escalation block (sonnet pricing > haiku, so the cap must
 * grow). `perWorkflowMaxUsd` from project budgets still caps the result.
 */
export function resolveEscalatedBudgets(
  skill: string,
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
  },
): ResolvedBudget | null {
  const base = SKILL_BUDGETS[skill];
  const override = projectBudgets?.skillBudgetOverrides?.[skill];

  const escalation = override?.escalation ?? base?.escalation;
  if (escalation == null) return null;

  const baseTurns = override?.maxTurns ?? base?.maxTurns ?? 10;
  const baseTimeout = override?.timeoutMs ?? base?.timeoutMs ?? 120_000;

  const maxTurns = escalation.maxTurns ?? baseTurns;
  const timeoutMs = escalation.timeoutMs ?? baseTimeout;
  let maxBudgetUsd = escalation.maxBudgetUsd;

  if (
    projectBudgets?.perWorkflowMaxUsd != null &&
    maxBudgetUsd > projectBudgets.perWorkflowMaxUsd
  ) {
    maxBudgetUsd = projectBudgets.perWorkflowMaxUsd;
  }

  return {
    budgets: { maxTurns, maxBudgetUsd, timeoutMs },
    modelOverride: defaultModelForTier(escalation.modelTier),
  };
}
