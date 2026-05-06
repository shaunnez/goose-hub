export interface SourceConfig {
  kind: 'github';
  repo: string;
  stateMachine: 'labels';
}

export interface TargetRepoConfig {
  cloneUrl: string;
  defaultBranch: string;
  localPath: string;
}

export interface StackConfig {
  runtime: string;
  packageManager: string;
  buildCommand?: string;
  testCommand: string;
  lintCommand?: string;
  typecheckCommand?: string;
  e2eCommand?: string;
  detectedAt: string;
}

export type ModelTier = 'haiku' | 'sonnet' | 'opus';
export type FallbackPolicy = 'same-tier-only' | 'allow-down-tier';
export type Role =
  | 'triager'
  | 'griller'
  | 'prd-writer'
  | 'decomposer'
  | 'investigator'
  | 'developer'
  | 'qa'
  | 'reviewer'
  | 'retrospector'
  | 'researcher'
  | 'coach';

export interface RoleModel {
  primary: ModelTier;
  fallback: ModelTier | null;
  advisor: ModelTier | null;
}

export interface ToolAllowlist {
  bundles: string[];
  extras?: string[];
}

export interface CoachPolicy {
  enabled: boolean;
  consistencyThreshold: number;
  minLifecycles: number;
  forbiddenTargets?: string[];
}

export interface AgentConfig {
  runtime: 'claude-cli';
  rolesModels: Record<Role, RoleModel>;
  fallbackPolicy: Record<string, FallbackPolicy>;
  toolAllowlists: Record<Role, ToolAllowlist>;
  advisorMode: {
    enabled: boolean;
    triggerOn: { priorities: string[] };
    maxAdvisorBudgetUsd: number;
    disableInAutonomous: boolean;
  };
  retrospectivePolicy: {
    defaultTier: 'light' | 'deep';
    deepTriggers: string[];
  };
  coachPolicy?: CoachPolicy;
}

export interface BudgetConfig {
  dailyTokens: number;
  maxParallelAgents: number;
  maxRetries: number;
  maxIssuesPerDayFromNonOwners: number;
  maxBashSeconds: number;
  perWorkflowMaxUsd: number;
  perAgentMaxUsd: number;
  perAdvisorMaxUsd: number;
  /** Per-project overrides for specific skill budgets. Merged over SKILL_BUDGETS defaults. */
  skillBudgetOverrides?: Record<
    string,
    { maxTurns?: number; maxBudgetUsd?: number; timeoutMs?: number; modelTier?: ModelTier }
  >;
}

export interface GovernanceConfig {
  immutablePaths: string[];
}

export interface IsolationConfig {
  mode: 'native' | 'docker';
}

export interface ProjectConfig {
  id: string;
  name: string;
  slug: string;
  source: SourceConfig;
  targetRepo: TargetRepoConfig;
  stack: StackConfig;
  mode: 'interactive' | 'supervised' | 'autonomous';
  storage: { kind: 'local'; path: string };
  repos: string[];
  agentConfig: AgentConfig;
  budgets: BudgetConfig;
  governance: GovernanceConfig;
  isolation: IsolationConfig;
  archiveAfterDays: number;
  visibility: 'always_visible' | 'hidden';
  machineScope?: string;
  colorStripe: string;
  activeMilestone?: string;
  tickIntervalSeconds?: number;
}
