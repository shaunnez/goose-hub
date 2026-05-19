import type { ModelTier, Role } from '../types.js';
import type { AgentBudgets } from './interface.js';

export interface RoleDefaults {
  modelTier: ModelTier;
  budgets: AgentBudgets;
}

/**
 * Roles that enforce holdout discipline (FACTORY_RULES rule 1): they never
 * see implementation reasoning, never receive a fallback retry, and never
 * have their model tier overridden by the router. Any reference to
 * `new Set(['qa', 'reviewer'])` should import this constant instead.
 */
export const HOLDOUT_ROLES: ReadonlySet<Role> = new Set<Role>(['qa', 'reviewer']);

/**
 * Priorities that gate the advise-on-plan skill and disable model fallback.
 * Same data was previously duplicated as `CRITICAL_PRIORITIES` (fallback.ts)
 * and `ADVISOR_GATED_PRIORITIES` (advisor.ts) — single source of truth here.
 */
export const ADVISOR_GATED_PRIORITIES: ReadonlySet<string> = new Set(['critical', 'high']);

/**
 * Per-role default model tier and agent budgets.
 * Project configs override these via agentConfig.rolesModels and budgets.skillBudgetOverrides.
 * The orchestrator merges project overrides on top of these defaults at runtime.
 */
export const ROLE_DEFAULTS: Record<Role, RoleDefaults> = {
  triager: {
    modelTier: 'haiku',
    budgets: { maxTurns: 10, maxBudgetUsd: 0.1, timeoutMs: 30_000 },
  },
  griller: {
    modelTier: 'opus',
    budgets: { maxTurns: 15, maxBudgetUsd: 1.5, timeoutMs: 30_000 },
  },
  'prd-writer': {
    modelTier: 'opus',
    budgets: { maxTurns: 20, maxBudgetUsd: 2.0, timeoutMs: 30_000 },
  },
  decomposer: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 15, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
  },
  investigator: {
    modelTier: 'opus',
    budgets: { maxTurns: 25, maxBudgetUsd: 2.0, timeoutMs: 30_000 },
  },
  developer: {
    modelTier: 'haiku',
    budgets: { maxTurns: 40, maxBudgetUsd: 2.0, timeoutMs: 30_000 },
  },
  qa: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 20, maxBudgetUsd: 1.0, timeoutMs: 30_000 },
  },
  reviewer: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 15, maxBudgetUsd: 0.8, timeoutMs: 30_000 },
  },
  'dev-reviewer': {
    /**
     * Codex pre-QA advisor (M19.11). NOT a holdout — it sits inside the dev
     * cycle and consumes the same diff the developer just produced. Sonnet-
     * tier (Codex equivalent resolved by the dispatcher) is enough; this
     * role is read-only and adversarial, not generative.
     */
    modelTier: 'sonnet',
    budgets: { maxTurns: 6, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
  },
  retrospector: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 20, maxBudgetUsd: 1.0, timeoutMs: 30_000 },
  },
  researcher: {
    modelTier: 'opus',
    budgets: { maxTurns: 20, maxBudgetUsd: 2.0, timeoutMs: 30_000 },
  },
  auditor: {
    modelTier: 'opus',
    budgets: { maxTurns: 30, maxBudgetUsd: 3.0, timeoutMs: 30_000 },
  },
  'intervention-proposer': {
    modelTier: 'sonnet',
    budgets: { maxTurns: 12, maxBudgetUsd: 0.5, timeoutMs: 120_000 },
  },
  // Hub Chat assistant — broad-read, interactive, non-holdout. Sonnet tier
  // is enough for the conversational use case; opus is too expensive for
  // multi-turn chat. Budget caps mirror the hub-chat skill entry in
  // SKILL_BUDGETS so a runaway turn can't pin chat at $3 per reply.
  assistant: {
    modelTier: 'sonnet',
    budgets: { maxTurns: 8, maxBudgetUsd: 0.4, timeoutMs: 60_000 },
  },
};

/** Returns defaults for a role, falling back to a safe sentinel if the role is unknown. */
export function getRoleDefaults(role: Role): RoleDefaults {
  return ROLE_DEFAULTS[role];
}
