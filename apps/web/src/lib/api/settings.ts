import type {
  CodexAuthStatusDto,
  DevReviewSettingsDto,
  ModelProvider,
  ModelTier,
  PipelineSettingsDto,
  ProjectModelSettingsDto,
  ProjectSettingsDto,
  ReviewSettingsDto,
  ReviewerSlot,
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
  patch: Record<string, number | null>,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/skills/${encodeURIComponent(skill)}`, patch);
}

export async function deleteSkillBudgetSetting(slug: string, skill: string): Promise<void> {
  await deleteRequest(`/projects/${slug}/settings/skills/${encodeURIComponent(skill)}`);
}

export async function fetchProjectModelSettings(
  slug: string,
  signal?: AbortSignal,
): Promise<ProjectModelSettingsDto> {
  return getJson<ProjectModelSettingsDto>(`/projects/${slug}/settings/models`, signal);
}

export async function patchRoleModelSetting(
  slug: string,
  role: string,
  patch: {
    primaryModel?: ModelTier | null;
    fallbackModel?: ModelTier | null;
    advisorModel?: ModelTier | null;
    primaryProvider?: ModelProvider | null;
    fallbackProvider?: ModelProvider | null;
    advisorProvider?: ModelProvider | null;
    maxTurns?: number | null;
    timeoutMs?: number | null;
  },
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/models/${encodeURIComponent(role)}`, patch);
}

/** UX-2: bulk-set primary (tier, provider) for every eligible role. */
export async function patchBulkRoleModel(
  slug: string,
  body: { tier: ModelTier; provider: ModelProvider },
): Promise<{ ok: true; rolesUpdated: number }> {
  return patchJson(`/projects/${slug}/settings/models/bulk`, body);
}

/** UX-1: reset ALL budget overrides (global + per-skill) for a project. */
export async function resetAllProjectBudgets(slug: string): Promise<void> {
  await deleteRequest(`/projects/${slug}/settings/budgets`);
}

export async function patchComplexityOverrides(
  slug: string,
  role: string,
  overrides: Record<string, ModelTier>,
): Promise<void> {
  await patchJson(
    `/projects/${slug}/settings/models/${encodeURIComponent(role)}/complexity`,
    overrides,
  );
}

export async function deleteRoleModelSetting(slug: string, role: string): Promise<void> {
  await deleteRequest(`/projects/${slug}/settings/models/${encodeURIComponent(role)}`);
}

export async function deleteAllRoleModelSettings(slug: string): Promise<void> {
  await deleteRequest(`/projects/${slug}/settings/models`);
}

export async function fetchCodexAuthStatus(
  slug: string,
  signal?: AbortSignal,
): Promise<CodexAuthStatusDto> {
  return getJson<CodexAuthStatusDto>(`/projects/${slug}/settings/codex-auth`, signal);
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
  useMultiAgentPipeline: boolean,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/pipeline`, { useMultiAgentPipeline });
}

export async function fetchReviewSettings(
  slug: string,
  signal?: AbortSignal,
): Promise<ReviewSettingsDto> {
  return getJson<ReviewSettingsDto>(`/projects/${slug}/settings/review`, signal);
}

export async function patchReviewSettings(
  slug: string,
  reviewerSlots: ReviewerSlot[] | null,
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/review`, { reviewerSlots });
}
