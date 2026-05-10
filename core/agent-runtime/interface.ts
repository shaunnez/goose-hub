import type { ZodType } from 'zod';
import type { AgentEvent } from '../event-stream/store.js';
import type { ModelTier, Role } from '../types.js';
import type { DecisionKind } from './decision-types.js';

export interface DecisionSummary {
  kind: DecisionKind;
  summary: string;
  evidence?: string;
}

export interface AgentBudgets {
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
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
  /** Persona identity for this run. Format: "<projectId>/<role>/<index>". Required. */
  personaId: string;
  /** Work-item driving this run. Promotes context.workItemId to first-class for runtime use. */
  workItemId?: string;
  modelOverride?: string;
  /** JSON Schema derived from the skill's output Zod schema, passed to --json-schema */
  outputJsonSchema?: Record<string, unknown>;
  /** Skill's prompt.md content, passed via --append-system-prompt */
  appendSystemPrompt?: string;
  /**
   * Override the workspace directory for this run. When provided, the runtime
   * uses this path as CWD instead of deriving ~/.factory/workspaces/<runId>/.
   * Used by QA to reuse the dev agent's worktree rather than creating a fresh one.
   */
  workspaceDir?: string;
  /** Additional env vars merged into the subprocess's minimal env at spawn time. */
  env?: Record<string, string>;
  /** Extra fields merged into the agent.run-started event payload. Use for workflow-specific metadata (roundNumber, tier, etc.) that the runtime layer doesn't know about. */
  extraEventPayload?: Record<string, unknown>;
  /**
   * Explicit MCP config path to pass via --mcp-config. Bypasses the bundle-based
   * resolution in resolveMcpConfigPath. Used when the MCP server must run from a
   * directory other than the workspace (e.g. playwright-repro needs the actual
   * repo node_modules, not a worktree).
   */
  mcpConfigPath?: string;
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
  /** Provider that executes this skill. Defaults to 'claude' when absent. */
  provider?: 'claude' | 'codex';
  freshContext: boolean;
  role?: Role;
  contextAllowlist: string[];
}

export class HoldoutFallbackForbiddenError extends Error {
  constructor(role: string) {
    super(
      `Fallback is forbidden for holdout role '${role}' — escalate to factory:needs-human instead`,
    );
    this.name = 'HoldoutFallbackForbiddenError';
  }
}
