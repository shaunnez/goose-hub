import type { ZodType } from 'zod';
import type { AgentEvent } from '../event-stream/store.js';
import type { ModelTier, Role } from '../types.js';

export interface DecisionSummary {
  step: string;
  summary: string;
  evidence?: string;
}

export interface AgentBudgets {
  maxTurns: number;
  maxBudgetUsd: number;
}

// ─── Role spec (discriminated union for type-level holdout enforcement) ────────

export type HoldoutRoleKind = 'qa' | 'reviewer';
type NonHoldoutRole = { kind: Exclude<Role, HoldoutRoleKind> };
type HoldoutRole = { kind: HoldoutRoleKind; requiresFreshContext: true; allowsAdvisor: false };

export type RoleSpec = NonHoldoutRole | HoldoutRole;

// ─── AgentSpec — generic so holdout roles enforce freshContext: true ──────────

export type AgentSpec<R extends RoleSpec = RoleSpec> = {
  /** Canonical workflow isolation key, used through all subprocess calls */
  runId: string;
  role: R['kind'];
  skill: string;
  context: Record<string, unknown>;
  contextAllowlist: string[];
  freshContext: R extends { requiresFreshContext: true } ? true : boolean;
  toolBundles: string[];
  toolExtras: string[];
  budgets: AgentBudgets;
  modelOverride?: string;
  /** JSON Schema derived from the skill's output Zod schema, passed to --json-schema */
  outputJsonSchema?: Record<string, unknown>;
};

export interface AgentResult {
  output: unknown;
  decisionSummaries: DecisionSummary[];
  events: AgentEvent[];
}

export interface AgentRuntime {
  run(spec: AgentSpec): Promise<AgentResult>;
}

// ─── SkillConfig — exported by each skill's skill.config.ts ──────────────────

export interface SkillConfig {
  contextSchema: ZodType;
  toolBundles: string[];
  modelPin: ModelTier;
  freshContext: boolean;
  role?: Role;
  contextAllowlist?: string[];
}
