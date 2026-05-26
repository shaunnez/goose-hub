export interface GitHubSourceConfig {
  kind: 'github';
  repo: string;
  stateMachine: 'labels';
}

export interface LocalDbSourceConfig {
  kind: 'local-db';
  stateMachine: 'db';
  integrations?: {
    github?: {
      repos: string[];
      mirrorLabels?: boolean;
      importIssues?: boolean;
    };
  };
}

export type SourceConfig = GitHubSourceConfig | LocalDbSourceConfig;

export interface TargetRepoConfig {
  cloneUrl: string;
  defaultBranch: string;
  localPath: string;
}

export interface ProjectRepositoryConfig extends TargetRepoConfig {
  id: string;
  repoRef: string;
  role?: 'code' | 'docs' | 'infra' | 'unknown';
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
export type RuntimeEffort = 'low' | 'medium' | 'high' | 'xhigh';
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
  | 'dev-reviewer'
  | 'retrospector'
  | 'researcher'
  | 'auditor'
  | 'intervention-proposer'
  | 'assistant';

export type ModelProvider = 'claude' | 'codex';

export interface RoleModel {
  primary: ModelTier;
  fallback: ModelTier | null;
  advisor: ModelTier | null;
  primaryProvider?: ModelProvider;
  fallbackProvider?: ModelProvider;
  advisorProvider?: ModelProvider;
}

export interface ToolAllowlist {
  bundles: string[];
  extras?: string[];
}

export interface CoachPolicy {
  /** Whether the auto-trigger is active. Default false in supervised mode. */
  enabled: boolean;
  /** Minimum pattern consistencyScore to treat as convergent. Default 0.8. */
  consistencyThreshold: number;
  /** Minimum lifecycle count in the retro window before coaching fires. Default 3. */
  minLifecycles: number;
}

export interface AgentConfig {
  /**
   * Agent runtime backend. 'auto' picks the runtime that matches the resolved
   * model's provider (Claude → claude-cli, Codex → codex-cli). M19.10 lands
   * the Codex CLI; this field declares the dispatcher shape.
   */
  runtime: 'claude-cli' | 'codex-cli' | 'auto';
  rolesModels: Partial<Record<Role, RoleModel>>;
  fallbackPolicy: Record<string, FallbackPolicy>;
  toolAllowlists: Partial<Record<Role, ToolAllowlist>>;
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
  modelRouter?: {
    /**
     * Project-level override table for model tier selection.
     * Keys are "role" (applies to all items for that role) or
     * "role+type:TYPE" / "role+priority:PRIORITY" for finer-grained control.
     * Example: { "developer+type:bug": "sonnet", "developer": "haiku" }
     */
    overrides?: Record<string, ModelTier>;
  };
  /**
   * When true, rolesModels may downgrade qa or reviewer model tiers.
   * Default false — override attempts are silently dropped to protect holdout
   * integrity. Only set this if you have a deliberate cost/quality trade-off.
   */
  allowHoldoutOverride?: boolean;
  holdoutReview?: {
    /** Run a Codex reviewer in parallel with the Claude reviewer (M19.13). Default false. */
    codexEnabled: boolean;
  };
  /**
   * Codex pre-QA dev-review advisor (M19.12). Default disabled.
   * When enabled, the implement workflow runs `skills/dev-review/` (Codex)
   * once per dev cycle before opening the PR. If blockers are found, the
   * developer gets ONE additional turn to address them. No second Codex pass.
   */
  devReview?: {
    enabled: boolean;
    /** Which work items trigger dev-review. Default 'priority:high+'. */
    triggerOn: 'all' | 'priority:medium+' | 'priority:high+' | 'priority:critical';
    /** Max additional dev turns when blockers are found. Default 1; hard-capped at 1. */
    maxRevisionTurns?: number;
    /** Codex budget cap per workflow cycle. On zero/negative, dev-review is skipped. */
    perCycleMaxUsd?: number;
    /** Codex timeout in ms. Default 180_000. */
    timeoutMs?: number;
  };
}

export interface BudgetConfig {
  dailyTokens: number;
  maxParallelAgents: number;
  /**
   * Per-issue scout fan-out cap for Wave-1 swarm dispatch (M19.01, ADR 0030).
   * Distinct from `maxParallelAgents` (which caps issue-level dispatch).
   * Default 6 — matches Steve's canonical 6-scout roster (schema, code-path,
   * pattern, test-inventory, dependency, user-journey). Does not consume
   * the per-issue dispatch slot.
   */
  maxScoutAgents?: number;
  maxRetries: number;
  perBashCommandMaxSeconds: number;
  perWorkflowMaxUsd: number;
  perAgentMaxUsd: number;
  perAdvisorMaxUsd: number;
  /** Per-project overrides for specific skill budgets. Merged over SKILL_BUDGETS defaults. */
  skillBudgetOverrides?: Record<
    string,
    {
      maxTurns?: number;
      maxBudgetUsd?: number;
      timeoutMs?: number;
      modelTier?: ModelTier;
      effort?: RuntimeEffort | null;
      escalation?: {
        modelTier: ModelTier;
        maxBudgetUsd: number;
        maxTurns?: number;
        timeoutMs?: number;
      };
    }
  >;
  implementWp?: {
    editTestLoopMaxCycles?: number;
    budgetSizing?: {
      bug?: { maxTurns?: number; maxBudgetUsd?: number };
      feature?: { maxTurns?: number; maxBudgetUsd?: number };
      complex?: { maxTurns?: number; maxBudgetUsd?: number };
      complexAdditions?: {
        highPriorityUsd?: number;
        manyFilesThreshold?: number;
        manyFilesUsd?: number;
        contractKeywords?: string[];
        contractUsd?: number;
      };
    };
  };
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
  repositories?: ProjectRepositoryConfig[];
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
  /** Maximum rounds for convergent adversarial review (M19.04). Default 3. */
  maxReviewRounds?: number;
  /**
   * How the orchestrator responds when Tier-3 regression detection fires.
   * 'escalate' — short-circuit with synthetic qa.completed → factory:qa-failed (default)
   * 'ignore'   — log as warning only; do not block the workflow
   * See docs/adr/0032-regression-policy.md
   */
  regressionPolicy?: 'escalate' | 'ignore';
  /**
   * QA e2e policy. The orchestrator decides whether an e2e command is passed
   * to QA; the QA agent only runs it when present.
   */
  qaE2eMode?: 'off' | 'ui-changed' | 'always';
  /** Enable BEFORE-state Playwright repro for browser bugs. Default true. */
  playwrightReproEnabled?: boolean;
  /** Enable AFTER-state evidence-post. Default true. */
  evidencePostEnabled?: boolean;
  /**
   * Investigation swarm toggle. Default true. When false, investigate skips
   * Wave-1/Wave-2 scouts and runs the synthesis investigator directly.
   */
  investigationSwarm?: {
    enabled: boolean;
  };
  /** Feature flags for experimental capabilities. Opt-in per project. */
  experimental?: {
    /** M19.06 — ship record-decision MCP tool for A/B evaluation. Default false. */
    recordDecisionTool?: boolean;
    /** Create tracking-only child issues from Engineering Spec WPs after spec-author. Default false. */
    wpIssueProjection?: boolean;
  };
}
