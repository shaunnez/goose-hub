export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: { kind: string; repo: string };
  defaultBranch?: string;
}

export interface WorkItemDto {
  id: string;
  externalId: string;
  repoRef: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  mode: string;
  state: string;
  authorIsOwner: boolean;
  milestoneId?: string;
  milestoneTitle?: string;
  schedule: string;
  exec: string;
  dependsOn: string[];
  dependsOnTitles?: Record<string, string>;
  blocks: string[];
  prdChildren?: string[];
  prdParent?: string;
  createdAt: string;
  lastPersonaId?: string | null;
}

export interface WorkPackageDto {
  id: string;
  filesOwned: string[];
  builderTier: string;
}

export interface EngineeringSpecDto {
  pipelineRunId: string;
  objective: string;
  workPackages: WorkPackageDto[];
  acceptanceCriteriaCount: number;
}

export interface IssueCommentDto {
  id: number;
  body: string;
  authorLogin: string;
  createdAt: string;
}

export interface MilestoneDto {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: string;
  isActive: boolean;
  state: 'open' | 'closed';
  openIssues: number;
  closedIssues: number;
}

export interface SprintReviewEligibility {
  eligible: boolean;
  reason: string;
  alreadyExists: boolean;
  existingIssueUrl?: string;
}

export interface AgentEventDto {
  id: number;
  projectId: string;
  workItemId: string | null;
  kind: string;
  payload: unknown;
  runId?: string | null;
  personaId?: string | null;
  createdAt: string;
}

export interface TransitionResult {
  ok?: boolean;
  error?: string;
  legalTargets?: string[];
}

export interface TriageRepoCandidate {
  repo: string;
  confidence: number;
  evidence: string;
  tier: number;
}

export interface TriageResultDto {
  type: string;
  priority: string;
  candidates: TriageRepoCandidate[];
  overrideRepo: string | null;
}

export interface InboxItemDto {
  id: number;
  title: string;
  body: string;
  type: string;
  createdAt: string;
}

export interface PersonaNameDto {
  personaId: string;
  codename: string;
  role: string;
}

export interface PersonaStatDto {
  id: number;
  personaName: string;
  codename: string | null;
  role: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  avgQualityScore: number;
  lastRunAt: string;
}

export interface PersonaRunDto {
  runId: string;
  workItemId: string | null;
  outcome: string;
  qualityScore: number;
  createdAt: string;
}

export interface IssueDiffDto {
  diff: string | null;
  runId: string | null;
  reason?: string;
}

export interface QualityComponentsDto {
  p0_count: number;
  p1_count: number;
  p2_count: number;
  p3_count: number;
  regressions_open: number;
  review_converged: boolean;
  uat_passed: boolean;
  static_passed: boolean;
  harness_pass_rate: number;
}

export interface QualityTrendPointDto {
  runId: string;
  projectId: string;
  iteration: number;
  score: number;
  components: QualityComponentsDto;
  auditScore: number | null;
  ts: string;
}

export type CostLabel = 'estimated' | 'exact';

export type CostStage =
  | 'triage'
  | 'discover'
  | 'investigate'
  | 'dev'
  | 'qa'
  | 'review'
  | 'retrospective'
  | 'other';

export interface CostRowDto {
  runId: string;
  workItemId: string | null;
  stage: CostStage;
  skill: string;
  modelId: string;
  provider: 'claude' | 'codex';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  personaId: string | null;
  createdAt: string;
}

export interface CostWindowTotals {
  totalUsd: number;
  totalRuns: number;
  hasEstimated: boolean;
}

export interface CostStageTotal extends CostWindowTotals {
  stage: CostStage;
}

export interface CostSummaryDto {
  projectId: string;
  dailyTokensUsed: number;
  dailyTokensLimit: number;
  dailyCostUsd: number;
  dailyBudgetExceeded: boolean;
  resetsAtUtc: string;
  lastExceededAt: string | null;
  windows: { week: CostWindowTotals; month: CostWindowTotals };
  byStage: CostStageTotal[];
  byProvider: {
    claude: CostWindowTotals;
    codex: CostWindowTotals;
  };
}

export interface WorkItemCostsDto {
  workItemId: string;
  totalUsd: number;
  hasEstimated: boolean;
  rows: CostRowDto[];
}

export interface ProjectConfigDto {
  slug: string;
  name: string;
  source: { kind: string; repo: string };
  activeMilestone: string | null;
  colorStripe: string;
  budgets: { perWorkflowMaxUsd: number; dailyTokens: number; perAdvisorMaxUsd: number };
  mode: string;
}

export interface ImprovementCandidateDto {
  id: number;
  projectId: string;
  personaName: string;
  sourceTaskId: string | null;
  suggestionText: string;
  suggestionType: string;
  status: string;
  githubIssueUrl: string | null;
  errorNote: string | null;
  proposedDiff: string | null;
  createdAt: string;
}

export interface PlaybookSummaryDto {
  id: number;
  projectId: string;
  windowStartAt: string;
  windowEndAt: string;
  lifecycleCount: number;
  topPatternCount: number;
  topCandidateCount: number;
  coachProposalCount: number;
  createdAt: string;
}

export interface PlaybookManifestDto {
  outcome: string;
  workItemNumber: number;
  windowStartAt: string;
  windowEndAt: string;
  lifecycleCount: number;
  summary: { wentWell: string; didNotGoWell: string; architecturalTakeaway: string };
  aggregatedLearnings: Array<{
    observation: string;
    rationale: string;
    improvementKind: string;
    targetPath?: string;
    confidence: string;
  }>;
  topPatterns: Array<{
    patternId: string;
    pattern: string;
    occurrenceCount: number;
    consistencyScore: number;
    role?: string;
    kind?: string;
    exampleWorkItemIds: string[];
  }>;
  gateThresholds: Array<{
    gate: 'qa' | 'review';
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    sampleCount: number;
  }>;
  costBaselines: Array<{
    role: string;
    skill: string;
    mean: number;
    p50: number;
    p95: number;
    sampleCount: number;
  }>;
  improvementCandidates: Array<{
    kind: string;
    targetPath: string;
    suggestionText: string;
    confidence: string;
    evidence?: string;
    proposedDiff?: string;
  }>;
  decisionSummaries: Array<{ kind: string; summary: string; evidence?: string }>;
}

export interface PlaybookDetailDto extends PlaybookSummaryDto {
  manifest: PlaybookManifestDto;
}

// ---------------------------------------------------------------------------
// Bootstrap wizard (M12.07, issue #308)
// ---------------------------------------------------------------------------

export interface BootstrapPreviewLabelDto {
  name: string;
  color: string;
  description: string;
}

export interface BootstrapPreviewDto {
  slug: string;
  defaultBranch: string;
  stack: {
    type: string;
    summary: string;
    raw: unknown;
  };
  audit: {
    action: 'create' | 'update' | 'ok';
    content: string;
    rationale: string;
  };
  labelsToInstall: BootstrapPreviewLabelDto[];
}

export interface BootstrapRunDto {
  status: 'created' | 'idempotent-skip';
  registrationPrUrl: string | null;
  slug: string;
  stackSummary: string;
  auditAction: 'create' | 'update' | 'ok';
  labelCounts?: { created: number; updated: number; skipped: number };
}

export interface ProjectSettingsDto {
  projectId: string;
  configBudgets: Record<string, unknown>;
  dbGlobalOverrides: {
    perWorkflowMaxUsd: number | null;
    perAgentMaxUsd: number | null;
    perAdvisorMaxUsd: number | null;
    dailyTokens: number | null;
    maxParallelAgents: number | null;
    maxScoutAgents: number | null;
    maxRetries: number | null;
    perBashCommandMaxSeconds: number | null;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
  dbPipelineFlags: {
    qaE2eMode: string | null;
    playwrightReproEnabled: number | null;
    evidencePostEnabled: number | null;
  } | null;
  dbSkillOverrides: Record<
    string,
    {
      maxTurns: number | null;
      maxBudgetUsd: number | null;
      timeoutMs: number | null;
      modelTier: ModelTier | null;
      provider: ModelProvider | null;
      updatedAt: string;
    }
  >;
  registeredSkills: string[];
  skillMetadata?: Record<
    string,
    {
      description: string | null;
      dependencies: string[];
      callers: string[];
    }
  >;
  /** SKILL_BUDGETS defaults — UX-3 hint surfaced under each per-skill input. */
  skillDefaults: Record<
    string,
    {
      maxTurns: number;
      maxBudgetUsd: number;
      timeoutMs: number;
      modelTier: ModelTier;
      modelProvider: ModelProvider;
    }
  >;
  resolvedSkillRuntimes?: Record<
    string,
    {
      source: string;
      effectiveTier: ModelTier;
      effectiveProvider: ModelProvider;
      resolvedPrimary: { tier: ModelTier; provider: ModelProvider; modelId: string } | null;
      resolvedFallback: { tier: ModelTier; provider: ModelProvider; modelId: string } | null;
      resolvedAdvisor: { tier: ModelTier; provider: ModelProvider; modelId: string } | null;
    }
  >;
}

export type WorkflowKind = 'bug' | 'feature' | 'chore' | 'research';
export type WorkflowEdgeKind = 'primary' | 'optional' | 'retry' | 'summary';

export interface WorkflowNodeDto {
  id: string;
  label: string;
  state?: string;
  skill?: string;
  role?: string;
  notes?: string;
}

export interface WorkflowEdgeDto {
  from: string;
  to: string;
  label?: string;
  condition?: string;
  kind?: WorkflowEdgeKind;
  virtual?: boolean;
}

export interface WorkflowCatalogEntryDto {
  kind: WorkflowKind;
  title: string;
  description: string;
  nodes: WorkflowNodeDto[];
  edges: WorkflowEdgeDto[];
  normalPath: string[];
}

export interface WorkflowCatalogDto {
  catalog: WorkflowCatalogEntryDto[];
}

export type ModelTier = 'haiku' | 'sonnet' | 'opus';
export type ModelProvider = 'claude' | 'codex';

export interface RoleModelDto {
  configRoleModel: {
    primary: string;
    primaryProvider: ModelProvider | null;
  } | null;
  dbRoleModel: {
    primaryModel: ModelTier | null;
    primaryProvider: ModelProvider | null;
    updatedAt: string | null;
  } | null;
  dbComplexityOverrides: Record<string, ModelTier>;
  /** Compatibility-only role primary model ID. Normal skill dispatch ignores role rows. */
  resolvedPrimary: string | null;
  /** The role's hardcoded default tier (claude). Used as a placeholder hint. */
  roleDefaultTier: ModelTier;
}

export interface ProjectModelSettingsDto {
  projectId: string;
  allowHoldoutOverride: boolean;
  roles: Record<string, RoleModelDto>;
}

export interface CodexAuthStatusDto {
  status: 'connected' | 'missing';
  authPath: string;
  loginCommand: string;
}

export interface DevReviewConfigDto {
  enabled: boolean;
  triggerOn: 'all' | 'priority:medium+' | 'priority:high+' | 'priority:critical';
  maxRevisionTurns?: number;
  perCycleMaxUsd?: number;
  timeoutMs?: number;
}

export interface DevReviewDbOverrideDto {
  enabled: boolean | null;
  triggerOn: string | null;
  maxRevisionTurns: number | null;
  perCycleMaxUsd: number | null;
  timeoutMs: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface DevReviewSettingsDto {
  projectId: string;
  config: DevReviewConfigDto | null;
  dbOverride: DevReviewDbOverrideDto | null;
}

export interface PipelineSettingsDto {
  projectId: string;
  useMultiAgentPipeline: boolean;
  useInvestigationSwarm: boolean;
  configDefaults?: {
    useInvestigationSwarm: boolean;
  };
}

export type ReviewerSlotModel = 'claude' | 'codex';
export type ReviewerSlotPrompt = 'default' | 'unconstrained';

export interface ReviewerSlot {
  model: ReviewerSlotModel;
  prompt: ReviewerSlotPrompt;
}

export interface ReviewSettingsDto {
  projectId: string;
  reviewerSlots: ReviewerSlot[] | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
