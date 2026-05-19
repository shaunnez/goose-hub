export interface RuntimeProfilerRunRow {
  runId: string;
  projectId: string;
  skill: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

export interface RuntimeProfilerEventRow {
  runId: string | null;
  kind: string;
  payload: unknown;
  createdAt: string;
}

export interface RuntimeProfilerWindow {
  days: number;
  sinceIso: string;
  untilIso: string;
}

export interface RuntimeProfilerMetrics {
  runCount: number;
  medianInputTokens: number;
  p95InputTokens: number;
  medianOutputTokens: number;
  p95OutputTokens: number;
  medianCostUsd: number;
  p95CostUsd: number;
  maxCostOutlier: { runId: string; costUsd: number } | null;
  timeoutRate: number;
  budgetExceededRate: number;
  schemaValidationRetryRate: number;
  toolCallCount: number;
  topToolNames: Array<{ name: string; count: number }>;
  repeatedBashCommands: Array<{ command: string; count: number }>;
  commonCommandSequences: Array<{ sequence: string[]; count: number }>;
}

export interface RuntimeProfilerRecommendation {
  kind:
    | 'timeout'
    | 'budget'
    | 'schema-validation'
    | 'tool-discipline'
    | 'lower-runtime'
    | 'workflow-helper'
    | 'qa-e2e-boundary';
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  evidence: string;
  suggestedPatch?: Record<string, unknown>;
}

export interface RuntimeSkillProfile {
  skill: string;
  metrics: RuntimeProfilerMetrics;
  recommendations: RuntimeProfilerRecommendation[];
}

export interface RuntimeProfilerReport {
  projectId: string;
  window: RuntimeProfilerWindow;
  skills: RuntimeSkillProfile[];
}
