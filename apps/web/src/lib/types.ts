export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: { kind: string; repo?: string; integrations?: unknown };
  defaultBranch?: string;
}

export interface WorkItemExternalRefDto {
  id: number;
  provider: string;
  kind: string;
  repoRef: string | null;
  externalId: string;
  url: string | null;
  metadata: unknown | null;
  createdAt: string;
}

export interface WorkItemDto {
  id: string;
  canonicalWorkItemId: string;
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
  externalRefs: WorkItemExternalRefDto[];
  createdAt: string;
  closedAt?: string | null;
  pipelineStartedAt?: string | null;
  pipelineCompletedAt?: string | null;
  lastPersonaId?: string | null;
}

export interface WorkPackageDto {
  id: string;
  filesOwned: string[];
  changes: string;
  dependsOn: string[];
  builderTier: string;
}

export interface EngineeringSpecArchitectureDto {
  current: string;
  new: string;
  decisionRationale: string;
}

export interface ExecutionBatchDto {
  batch: number;
  wpIds: string[];
}

export interface VerificationToolDto {
  name: string;
  command: string;
  expectedExitCodes: number[];
  inputSpec?: string | null;
}

export interface InterfaceContractDto {
  name: string;
  signature: string;
  file: string;
  requiredExports?: Array<{ name: string; file?: string }>;
  lineRange?: string | null;
}

export interface SchemaChangesDto {
  ddl: string[];
  migrations: string[];
}

export interface ConstraintDto {
  kind: string;
  name: string;
  source: string;
}

export interface RiskEntryDto {
  risk: string;
  mitigation: string;
  severity: string;
}

export interface AcceptanceCriterionDto {
  id: string;
  statement: string;
  journeyRef?: string | null;
  stepIdx?: number | null;
  crossCutting?: boolean | null;
  sourceRef?: string;
  source?: string;
  executableChecks?: ExecutableCheckDto[];
}

export interface ExecutableCheckDto {
  id: string;
  command: string;
  expectedExitCodes?: number[];
  outputExpectation?: {
    mode: 'exact' | 'contains' | 'regex';
    value: string;
  };
  evidenceExpectation?:
    | { type: 'exit-code' }
    | { type: 'vitest-json'; suite?: string; testName?: string; expectedStatus: 'passed' };
  timeoutMs?: number;
  kind?: 'unit' | 'integration' | 'e2e' | 'api' | 'lint' | 'typecheck' | 'custom';
}

export interface AcceptanceContractDto {
  source: 'normalized' | 'engineering-spec' | 'prd' | 'issue-body';
  criteria: AcceptanceCriterionDto[];
  runId?: string | null;
  eventId?: number;
  createdAt?: string;
}

export interface EngineeringSpecDto {
  pipelineRunId: string;
  updatedAt: string;
  objective: string;
  architecture?: EngineeringSpecArchitectureDto;
  workPackages: WorkPackageDto[];
  executionOrder: ExecutionBatchDto[];
  verificationTooling: VerificationToolDto[];
  acceptanceCriteria: AcceptanceCriterionDto[];
  acceptanceCriteriaCount: number;
  interfaceContracts: InterfaceContractDto[];
  schemaChanges?: SchemaChangesDto;
  constraints: ConstraintDto[];
  riskRegister: RiskEntryDto[];
}

export interface IssueCommentDto {
  id: number;
  body: string;
  authorLogin: string;
  createdAt: string;
}

export interface PrdReadModelDto {
  prd: unknown | null;
  advisorConcerns: string | null;
  source: 'event';
  createdAt: string;
  runId: string | null;
}

export interface ChangelogEntryDto {
  number: number;
  title: string;
  mergedAt: string;
  url: string;
  repo: string;
  author: string;
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

export type InterventionStatus =
  | 'OPEN'
  | 'PROPOSED'
  | 'DECIDED'
  | 'APPLYING'
  | 'APPLIED'
  | 'FAILED'
  | 'VERIFIED'
  | 'RESOLVED'
  | 'ABORTED'
  | 'SUPERSEDED';

export type InterventionType =
  | 'needs_human'
  | 'gate_pending'
  | 'prd_review'
  | 'merge_conflict'
  | 'qa_disagreement'
  | 'manual_override';

export type InterventionActionType =
  | 'manual_transition'
  | 'approve_gate'
  | 'reject_gate'
  | 'resume_workflow'
  | 'resolve_conflict'
  | 'no_action';

export interface InterventionOptionDto {
  actionType: InterventionActionType | string;
  label: string;
  description: string;
  payload: unknown;
  risk: 'low' | 'medium' | 'high';
}

export interface InterventionDto {
  id: string;
  projectId: string;
  workItemId: string;
  interventionType: InterventionType;
  status: InterventionStatus;
  title: string;
  reason: string;
  rootCauseSignature: string;
  correlationId: string;
  sourceEventId: number | null;
  proposedOptions: InterventionOptionDto[];
  decidedActionType: string | null;
  decidedActionPayload: unknown | null;
  decidedBy: string | null;
  decisionReason: string | null;
  applicationResult: unknown | null;
  verification: unknown | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface InterventionEventDto {
  id: number;
  interventionId: string;
  projectId: string;
  workItemId: string;
  eventType: string;
  actor: string;
  fromStatus: InterventionStatus | null;
  toStatus: InterventionStatus | null;
  payload: unknown;
  correlationId: string;
  createdAt: string;
}

export interface LegalTargetsDto {
  from: string;
  legalTargets: string[];
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
  repositories: string[];
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
  | 'chat'
  | 'other';

export interface CostRowDto {
  runId: string;
  workItemId: string | null;
  stage: CostStage;
  skill: string;
  modelId: string;
  provider: 'claude' | 'codex';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  cacheHitRatio: number;
  personaId: string | null;
  createdAt: string;
  readCount?: number;
  grepCount?: number;
  writeCount?: number;
  editCount?: number;
  bytesRead?: number;
  uniquePathsRead?: number;
  redundantReads?: number;
}

export interface CostWindowTotals {
  totalUsd: number;
  totalRuns: number;
  hasEstimated: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  cacheHitRatio: number;
}

export interface CostStageTotal extends CostWindowTotals {
  stage: CostStage;
}

export interface SymbolIndexLookupReportDto {
  lookupCount: number;
  averageIdentifiersPerLookup: number;
  averageHintsPerLookup: number;
  staleRate: number;
  hintsUsedEventCount: number;
  usedHintCount: number;
  hintsByConsumerSkill: Record<
    string,
    { lookupCount: number; averageHints: number; totalHints: number }
  >;
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
  symbolIndex: SymbolIndexLookupReportDto;
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
  source: { kind: string; repo?: string; integrations?: unknown };
  targetRepo: { cloneUrl: string; defaultBranch: string; localPath: string };
  stack: {
    runtime: string;
    packageManager: string;
    testCommand: string;
    lintCommand?: string;
    typecheckCommand?: string;
    e2eCommand?: string;
  };
  activeMilestone: string | null;
  colorStripe: string;
  budgets: { perWorkflowMaxUsd: number; dailyTokens: number; perAdvisorMaxUsd: number };
  mode: string;
  storage: { path: string };
  isolation: { mode: string };
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
  name: string;
  defaultBranch: string;
  repos: Array<{
    repoRef: string;
    defaultBranch: string;
    description: string;
    stackSummary: string;
    auditAction: 'create' | 'update' | 'ok';
    auditPath: string | null;
  }>;
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

export type ProjectCreationSourceDto =
  | { kind: 'local-only' }
  | { kind: 'github-code'; repoRefs: string[]; defaultBranch?: string; localPath?: string }
  | {
      kind: 'jira';
      baseUrl: string;
      projectKeys: string[];
      importMode: 'manual' | 'assigned-to-me';
    }
  | { kind: 'bitbucket'; workspace: string; repos: string[]; defaultBranch?: string }
  | {
      kind: 'advanced';
      github?: { repoRefs: string[]; defaultBranch?: string; localPath?: string };
      jira?: {
        baseUrl: string;
        projectKeys: string[];
        importMode: 'manual' | 'assigned-to-me';
      };
      bitbucket?: { workspace: string; repos: string[]; defaultBranch?: string };
    };

export interface LocalProjectCreationRequestDto {
  slug?: string;
  name?: string;
  source: ProjectCreationSourceDto;
}

export interface LocalProjectCreationPreviewDto {
  slug: string;
  name: string;
  configPath: string;
  config: string;
  requiredEnvVars: string[];
  repositories: Array<{
    id: string;
    repoRef: string;
    cloneUrl: string;
    defaultBranch: string;
    localPath: string;
    role?: 'code' | 'docs' | 'infra' | 'unknown';
  }>;
  integrations: Array<'github' | 'jira' | 'bitbucket'>;
}

export interface LocalProjectCreationRunDto extends LocalProjectCreationPreviewDto {
  status: 'created';
  writtenPath: string;
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
  implementWpDefaults: ImplementWpSettingsDto;
  resolvedImplementWp: ImplementWpSettingsDto;
  dbImplementWpOverrides: ImplementWpSettingsOverrideDto | null;
  dbSkillOverrides: Record<
    string,
    {
      maxTurns: number | null;
      maxBudgetUsd: number | null;
      timeoutMs: number | null;
      modelTier: ModelTier | null;
      provider: ModelProvider | null;
      effort: RuntimeEffort | null;
      escalationModelTier: ModelTier | null;
      escalationMaxBudgetUsd: number | null;
      escalationMaxTurns: number | null;
      escalationTimeoutMs: number | null;
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
      effort: RuntimeEffort | null;
      escalation: {
        modelTier: ModelTier;
        maxBudgetUsd: number;
        maxTurns: number | null;
        timeoutMs: number | null;
      } | null;
    }
  >;
  resolvedSkillRuntimes?: Record<
    string,
    {
      /** Compact compatibility summary for older settings consumers. */
      source: string;
      effectiveTier: ModelTier;
      effectiveProvider: ModelProvider;
      effectiveEffort: RuntimeEffort | null;
      resolvedPrimary: { tier: ModelTier; provider: ModelProvider; modelId: string } | null;
      resolvedFallback: { tier: ModelTier; provider: ModelProvider; modelId: string } | null;
      resolvedAdvisor: { tier: ModelTier; provider: ModelProvider; modelId: string } | null;
      resolvedEscalation: {
        modelId: string;
        budgets: { maxTurns: number; maxBudgetUsd: number; timeoutMs: number };
      } | null;
      /** Human-readable summary of the per-axis runtime resolution. */
      selectionReason?: string;
      /**
       * Per-axis runtime provenance. Each decision records the selected value,
       * source layer, and reason so the UI can explain mixed inheritance such
       * as DB tier + config effort or forced runtime provider coercion.
       */
      resolutionTrace?: RuntimeResolutionTraceDto;
    }
  >;
}

export interface ImplementWpSettingsDto {
  editTestLoopMaxCycles: number;
  bugMaxTurns: number;
  bugMaxBudgetUsd: number;
  featureMaxTurns: number;
  featureMaxBudgetUsd: number;
  complexMaxTurns: number;
  complexMaxBudgetUsd: number;
  highPriorityUsd: number;
  manyFilesThreshold: number;
  manyFilesUsd: number;
  contractKeywords: string[];
  contractUsd: number;
}

export type ImplementWpSettingsOverrideDto = {
  implementWpEditTestLoopMaxCycles: number | null;
  implementWpBugMaxTurns: number | null;
  implementWpBugMaxBudgetUsd: number | null;
  implementWpFeatureMaxTurns: number | null;
  implementWpFeatureMaxBudgetUsd: number | null;
  implementWpComplexMaxTurns: number | null;
  implementWpComplexMaxBudgetUsd: number | null;
  implementWpHighPriorityUsd: number | null;
  implementWpManyFilesThreshold: number | null;
  implementWpManyFilesUsd: number | null;
  implementWpContractKeywords: string[] | null;
  implementWpContractUsd: number | null;
  updatedAt: string;
  updatedBy: string | null;
};

export interface RuntimeTraceDecisionDto<T> {
  value: T;
  source: string;
  reason: string;
}

export interface RuntimeResolutionTraceDto {
  tier: RuntimeTraceDecisionDto<ModelTier>;
  provider: RuntimeTraceDecisionDto<ModelProvider>;
  effort?: RuntimeTraceDecisionDto<RuntimeEffort>;
}

export interface RuntimeProfilerDto {
  projectId: string;
  window: {
    days: number;
    sinceIso: string;
    untilIso: string;
  };
  skills: Array<{
    skill: string;
    metrics: {
      runCount: number;
      medianInputTokens: number;
      p95InputTokens: number;
      medianOutputTokens: number;
      p95OutputTokens: number;
      medianCostUsd: number;
      p95CostUsd: number;
      p95ReadCount: number;
      p95BytesRead: number;
      maxCostOutlier: { runId: string; costUsd: number } | null;
      timeoutRate: number;
      budgetExceededRate: number;
      schemaValidationRetryRate: number;
      toolCallCount: number;
      topToolNames: Array<{ name: string; count: number }>;
      repeatedBashCommands: Array<{ command: string; count: number }>;
      commonCommandSequences: Array<{ sequence: string[]; count: number }>;
    };
    recommendations: Array<{
      kind: string;
      severity: 'info' | 'warning' | 'critical';
      summary: string;
      evidence: string;
      suggestedPatch?: Record<string, unknown>;
    }>;
  }>;
}

export type WorkflowKind = 'bug' | 'feature' | 'chore' | 'research';
export type WorkflowEdgeKind = 'primary' | 'optional' | 'retry' | 'summary';
export type WorkflowGroup =
  | 'triage'
  | 'grounding'
  | 'investigation'
  | 'grill'
  | 'prd'
  | 'decompose'
  | 'delivery-router'
  | 'implementation'
  | 'dev-review'
  | 'qa'
  | 'review'
  | 'conflict'
  | 'retro'
  | 'research'
  | 'terminal';
export type WorkflowMode =
  | 'always'
  | 'legacy'
  | 'multi-agent'
  | 'single-investigation'
  | 'swarm'
  | 'dev-review'
  | 'single-review'
  | 'convergent-review'
  | 'conditional';
export type WorkflowActivationSetting =
  | 'useInvestigationSwarm'
  | 'useMultiAgentPipeline'
  | 'devReview.enabled'
  | 'review.convergent'
  | 'workItem.simpleBug'
  | 'workItem.missingPromotionSeed'
  | 'priority.highCritical'
  | 'playwrightRepro.enabled'
  | 'evidencePost.enabled';
export type WorkflowVisual = 'state' | 'skill' | 'gate' | 'fanout' | 'loop' | 'terminal';

export interface WorkflowActivationDto {
  setting: WorkflowActivationSetting;
  value?: boolean | string;
  label: string;
}

export interface WorkflowNodeDto {
  id: string;
  label: string;
  state?: string;
  skill?: string;
  role?: string;
  notes?: string;
  group?: WorkflowGroup;
  mode?: WorkflowMode;
  activation?: WorkflowActivationDto;
  visual?: WorkflowVisual;
}

export interface WorkflowEdgeDto {
  from: string;
  to: string;
  label?: string;
  condition?: string;
  kind?: WorkflowEdgeKind;
  virtual?: boolean;
}

export interface WorkflowVariantDto {
  id: string;
  title: string;
  description?: string;
  mode: WorkflowMode;
  activation?: WorkflowActivationDto;
  nodes: string[];
}

export interface WorkflowBranchDto {
  id: string;
  title: string;
  description?: string;
  kind: 'conditional' | 'retry' | 'failure';
  nodes: string[];
  activation?: WorkflowActivationDto;
}

export interface WorkflowStageDto {
  id: string;
  title: string;
  description?: string;
  group: WorkflowGroup;
  nodes: string[];
  variants?: WorkflowVariantDto[];
  branches?: WorkflowBranchDto[];
}

export interface WorkflowCatalogEntryDto {
  kind: WorkflowKind;
  title: string;
  description: string;
  nodes: WorkflowNodeDto[];
  edges: WorkflowEdgeDto[];
  normalPath: string[];
  stages: WorkflowStageDto[];
}

export interface WorkflowCatalogDto {
  catalog: WorkflowCatalogEntryDto[];
}

export type ModelTier = 'haiku' | 'sonnet' | 'opus';
export type ModelProvider = 'claude' | 'codex';
export type RuntimeEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface CliAuthStatusDto {
  status: 'connected' | 'missing';
  authPath: string;
  credentialSource?: string;
  loginCommand: string;
}

export type ClaudeAuthStatusDto = CliAuthStatusDto;
export type CodexAuthStatusDto = CliAuthStatusDto;

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

export interface LearningLoopSettingsDto {
  projectId: string;
  coachPolicy: {
    enabled: boolean;
    consistencyThreshold: number;
    minLifecycles: number;
  };
  configDefaults: {
    enabled: boolean;
    consistencyThreshold: number;
    minLifecycles: number;
  };
  dbOverrides: {
    enabled: boolean | null;
    consistencyThreshold: number | null;
    minLifecycles: number | null;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
}

export type ReviewerSlotPrompt = 'default' | 'unconstrained';

export interface ReviewerSlot {
  prompt: ReviewerSlotPrompt;
}

export interface ReviewSettingsDto {
  projectId: string;
  reviewerSlots: ReviewerSlot[] | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SearchHitDto {
  projectSlug: string;
  externalId: string;
  title: string;
  state: string;
  type: string;
  priority: string;
  milestoneTitle: string | null;
  repoRef: string;
  confidence: number;
}

export interface EventHitDto {
  eventId: number;
  projectSlug: string;
  workItemExternalId: string | null;
  eventKind: string;
  summary: string;
  decisionKind: string | null;
  createdAt: string;
  confidence: number;
}

export interface SearchResultDto {
  items: SearchHitDto[];
  events: EventHitDto[];
  total: number;
  totalEvents: number;
  hasMore: boolean;
}

// ───── M20 Hub Chat ─────────────────────────────────────────────────────────

export type ChatScope = 'global' | 'project' | 'item';
export type ChatRuntime = 'claude' | 'codex';
export type ChatMessageRole = 'user' | 'agent';
export type ChatToolStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'completed'
  | 'failed';

export interface ChatConversationDto {
  id: string;
  scope: ChatScope;
  projectId: string | null;
  workItemId: string | null;
  title: string;
  runtime: ChatRuntime;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDto {
  id: number;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  runId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatToolInvocationDto {
  id: string;
  conversationId: string;
  messageId: number | null;
  toolName: string;
  input: Record<string, unknown>;
  mutating: boolean;
  status: ChatToolStatus;
  result: unknown;
  errorMessage: string | null;
  /** Set when the tool spawned an agent-runtime run (M20.09). */
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatToolManifestDto {
  name: string;
  description: string;
  mutating: boolean;
}
