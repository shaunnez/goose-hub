import type { AgentEvent } from '../event-stream/store.js';
import type { Role } from '../types.js';

export interface DecisionSummary {
  step: string;
  summary: string;
  evidence?: string;
}

export interface AgentBudgets {
  maxTurns: number;
  maxBudgetUsd: number;
}

export interface AgentSpec {
  /** Canonical workflow isolation key, used through all subprocess calls */
  runId: string;
  role: Role;
  skill: string;
  context: Record<string, unknown>;
  contextAllowlist: string[];
  freshContext: boolean;
  toolBundles: string[];
  toolExtras: string[];
  budgets: AgentBudgets;
  modelOverride?: string;
}

export interface AgentResult {
  output: unknown;
  decisionSummaries: DecisionSummary[];
  events: AgentEvent[];
}

export interface AgentRuntime {
  run(spec: AgentSpec): Promise<AgentResult>;
}
