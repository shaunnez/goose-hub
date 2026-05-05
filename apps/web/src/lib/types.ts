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
  blocks: string[];
  createdAt: string;
  lastPersonaId?: string | null;
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

export type CostLabel = 'estimated' | 'exact';

export type CostStage =
  | 'triage'
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
  windows: { week: CostWindowTotals; month: CostWindowTotals };
  byStage: CostStageTotal[];
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
  createdAt: string;
}
