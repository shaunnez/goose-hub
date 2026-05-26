import type {
  ClaudeAuthStatusDto,
  CodexAuthStatusDto,
  DevReviewSettingsDto,
  LearningLoopSettingsDto,
  ModelProvider,
  ModelTier,
  PipelineSettingsDto,
  ProjectSettingsDto,
  ReviewSettingsDto,
  ReviewerSlot,
  RuntimeEffort,
  RuntimeProfilerDto,
  WorkflowCatalogDto,
} from '../types.js';
import { deleteRequest, getJson, patchJson } from './client.js';

export async function fetchProjectSettings(
  slug: string,
  signal?: AbortSignal,
): Promise<ProjectSettingsDto> {
  return getJson<ProjectSettingsDto>(`/projects/${slug}/settings`, signal);
}

export async function patchGlobalBudgetSettings(
  slug: string,
  patch: Record<string, number | null>,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/global`, patch);
}

export async function patchSkillBudgetSetting(
  slug: string,
  skill: string,
  patch: Partial<{
    maxTurns: number | null;
    maxBudgetUsd: number | null;
    timeoutMs: number | null;
    modelTier: ModelTier | null;
    provider: ModelProvider | null;
    effort: RuntimeEffort | null;
  }>,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/skills/${encodeURIComponent(skill)}`, patch);
}

export async function deleteSkillBudgetSetting(slug: string, skill: string): Promise<void> {
  await deleteRequest(`/projects/${slug}/settings/skills/${encodeURIComponent(skill)}`);
}

/** UX-1: reset ALL budget overrides (global + per-skill) for a project. */
export async function resetAllProjectBudgets(slug: string): Promise<void> {
  await deleteRequest(`/projects/${slug}/settings/budgets`);
}

export async function fetchCodexAuthStatus(
  slug: string,
  signal?: AbortSignal,
): Promise<CodexAuthStatusDto> {
  return getJson<CodexAuthStatusDto>(`/projects/${slug}/settings/codex-auth`, signal);
}

export async function fetchClaudeAuthStatus(
  slug: string,
  signal?: AbortSignal,
): Promise<ClaudeAuthStatusDto> {
  return getJson<ClaudeAuthStatusDto>(`/projects/${slug}/settings/claude-auth`, signal);
}

export async function fetchRuntimeProfiler(
  slug: string,
  signal?: AbortSignal,
): Promise<RuntimeProfilerDto> {
  return getJson<RuntimeProfilerDto>(`/projects/${slug}/runtime-profiler?days=14`, signal);
}

export async function fetchDevReviewSettings(
  slug: string,
  signal?: AbortSignal,
): Promise<DevReviewSettingsDto> {
  return getJson<DevReviewSettingsDto>(`/projects/${slug}/settings/dev-review`, signal);
}

export async function patchDevReviewSettings(
  slug: string,
  patch: Partial<{
    enabled: boolean | null;
    triggerOn: string | null;
    maxRevisionTurns: number | null;
    perCycleMaxUsd: number | null;
    timeoutMs: number | null;
  }>,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/dev-review`, patch);
}

export async function fetchPipelineSettings(
  slug: string,
  signal?: AbortSignal,
): Promise<PipelineSettingsDto> {
  return getJson<PipelineSettingsDto>(`/projects/${slug}/settings/pipeline`, signal);
}

export async function patchPipelineSettings(
  slug: string,
  patch: { useMultiAgentPipeline?: boolean; useInvestigationSwarm?: boolean },
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/pipeline`, patch);
}

export async function fetchLearningLoopSettings(
  slug: string,
  signal?: AbortSignal,
): Promise<LearningLoopSettingsDto> {
  return getJson<LearningLoopSettingsDto>(`/projects/${slug}/settings/learning-loop`, signal);
}

export async function patchLearningLoopSettings(
  slug: string,
  patch: Partial<{
    enabled: boolean | null;
    consistencyThreshold: number | null;
    minLifecycles: number | null;
  }>,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/learning-loop`, patch);
}

export async function fetchReviewSettings(
  slug: string,
  signal?: AbortSignal,
): Promise<ReviewSettingsDto> {
  return getJson<ReviewSettingsDto>(`/projects/${slug}/settings/review`, signal);
}

export async function fetchWorkflowCatalog(signal?: AbortSignal): Promise<WorkflowCatalogDto> {
  return getJson<WorkflowCatalogDto>('/workflow-catalog', signal);
}

export async function patchReviewSettings(
  slug: string,
  reviewerSlots: ReviewerSlot[] | null,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/review`, { reviewerSlots });
}
