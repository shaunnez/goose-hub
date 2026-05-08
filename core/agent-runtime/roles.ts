import type { ModelTier, Role } from '../types.js';
import type { AgentBudgets } from './interface.js';

export interface RoleDefaults {
  modelTier: ModelTier;
  budgets: AgentBudgets;
}

/**
 * Per-role default model tier and agent budgets.
 * Project configs override these via agentConfig.rolesModels and budgets.skillBudgetOverrides.
 * The orchestrator merges project overrides on top of these defaults at runtime.
 */
export const ROLE_DEFAULTS: Record<Role, RoleDefaults> = {
  triager: {
    modelTier: 'haiku',
    budgets: { maxTurns: 10, maxBudgetUsd: 0.1 },
  },
  griller: {
    modelTier: 'opus',
    budgets: { maxTurns: 15, maxBudgetUsd: 1.5 },
  },
  'prd-writer': {
    modelTier: 'opus',
    budgets: { maxTurns: 20, maxBudgetUsd: 2.0 },
  },
  decomposer: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 15, maxBudgetUsd: 0.5 },
  },
  investigator: {
    modelTier: 'opus',
    budgets: { maxTurns: 25, maxBudgetUsd: 2.0 },
  },
  developer: {
    modelTier: 'haiku',
    budgets: { maxTurns: 40, maxBudgetUsd: 2.0 },
  },
  qa: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 20, maxBudgetUsd: 1.0 },
  },
  reviewer: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 15, maxBudgetUsd: 0.8 },
  },
  'dev-reviewer': {
    /**
     * Codex pre-QA advisor (M19.11). NOT a holdout — it sits inside the dev
     * cycle and consumes the same diff the developer just produced. Sonnet-
     * tier (Codex equivalent resolved by the dispatcher) is enough; this
     * role is read-only and adversarial, not generative.
     */
    modelTier: 'sonnet',
    budgets: { maxTurns: 6, maxBudgetUsd: 0.5 },
  },
  retrospector: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 20, maxBudgetUsd: 1.0 },
  },
  researcher: {
    modelTier: 'opus',
    budgets: { maxTurns: 20, maxBudgetUsd: 2.0 },
  },
  auditor: {
    modelTier: 'opus',
    budgets: { maxTurns: 30, maxBudgetUsd: 3.0 },
  },
};

/** Returns defaults for a role, falling back to a safe sentinel if the role is unknown. */
export function getRoleDefaults(role: Role): RoleDefaults {
  return ROLE_DEFAULTS[role];
}
