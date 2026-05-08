import type {
  AgentEventDto,
  BootstrapPreviewDto,
  BootstrapRunDto,
  CostSummaryDto,
  ImprovementCandidateDto,
  InboxItemDto,
  IssueCommentDto,
  IssueDiffDto,
  MilestoneDto,
  PersonaNameDto,
  PersonaRunDto,
  PersonaStatDto,
  PlaybookDetailDto,
  PlaybookSummaryDto,
  ProjectConfigDto,
  ProjectSummary,
  QualityTrendPointDto,
  SprintReviewEligibility,
  TransitionResult,
  TriageResultDto,
  WorkItemCostsDto,
  WorkItemDto,
} from './types.js';

export type {
  ProjectConfigDto,
  ProjectSummary,
  WorkItemDto,
  IssueCommentDto,
  IssueDiffDto,
  MilestoneDto,
  SprintReviewEligibility,
  AgentEventDto,
  TransitionResult,
  InboxItemDto,
  TriageResultDto,
  PersonaStatDto,
  PersonaNameDto,
  PersonaRunDto,
  ImprovementCandidateDto,
  CostSummaryDto,
  WorkItemCostsDto,
  PlaybookSummaryDto,
  PlaybookDetailDto,
  BootstrapPreviewDto,
  BootstrapRunDto,
} from './types.js';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

async function deleteRequest(path: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
}

export async function fetchProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  const { projects } = await getJson<{ projects: ProjectSummary[] }>('/projects', signal);
  return projects;
}

export async function fetchProjectConfigs(signal?: AbortSignal): Promise<ProjectConfigDto[]> {
  const { configs } = await getJson<{ configs: ProjectConfigDto[] }>('/projects/configs', signal);
  return configs;
}

export async function fetchIssues(slug: string, opts?: { all?: boolean }): Promise<WorkItemDto[]> {
  const qs = opts?.all ? '?all=true' : '';
  const { items } = await getJson<{ items: WorkItemDto[] }>(`/projects/${slug}/issues${qs}`);
  return items;
}

export async function fetchIssue(slug: string, id: string): Promise<WorkItemDto> {
  const { item } = await getJson<{ item: WorkItemDto }>(`/projects/${slug}/issues/${id}`);
  return item;
}

export async function fetchClosedIssues(
  slug: string,
  milestoneNumber: number,
): Promise<WorkItemDto[]> {
  const { items } = await getJson<{ items: WorkItemDto[] }>(
    `/projects/${slug}/milestones/${milestoneNumber}/closed-issues`,
  );
  return items;
}

export async function fetchMilestoneIssues(
  slug: string,
  milestoneNumber: number,
): Promise<WorkItemDto[]> {
  const { items } = await getJson<{ items: WorkItemDto[] }>(
    `/projects/${slug}/milestones/${milestoneNumber}/issues`,
  );
  return items;
}

export async function fetchMilestones(slug: string, signal?: AbortSignal): Promise<MilestoneDto[]> {
  const { milestones } = await getJson<{ milestones: MilestoneDto[] }>(
    `/projects/${slug}/milestones`,
    signal,
  );
  return milestones;
}

export async function fetchActiveMilestone(
  slug: string,
  signal?: AbortSignal,
): Promise<{ milestoneNumber: number | null; source: string }> {
  return getJson<{ milestoneNumber: number | null; source: string }>(
    `/projects/${slug}/active-milestone`,
    signal,
  );
}

export async function setActiveMilestone(
  slug: string,
  milestoneNumber: number | null,
): Promise<void> {
  await postJson(`/projects/${slug}/active-milestone`, { milestoneNumber });
}

export async function createMilestone(slug: string, title: string): Promise<MilestoneDto> {
  const { milestone } = await postJson<{ milestone: MilestoneDto }>(
    `/projects/${slug}/milestones`,
    { title },
  );
  return milestone;
}

export async function updateMilestone(
  slug: string,
  number: number,
  patch: { title?: string; state?: 'open' | 'closed' },
): Promise<MilestoneDto> {
  const { milestone } = await patchJson<{ milestone: MilestoneDto }>(
    `/projects/${slug}/milestones/${number}`,
    patch,
  );
  return milestone;
}

export async function deleteMilestone(slug: string, number: number): Promise<void> {
  await deleteRequest(`/projects/${slug}/milestones/${number}`);
}

export async function fetchSprintReviewEligibility(
  slug: string,
  number: number,
): Promise<SprintReviewEligibility> {
  return getJson<SprintReviewEligibility>(
    `/projects/${slug}/milestones/${number}/sprint-review-eligibility`,
  );
}

export async function triggerSprintReview(
  slug: string,
  milestoneTitle: string,
): Promise<{ issueNumber: number }> {
  return postJson<{ issueNumber: number }>(
    `/projects/${slug}/milestones/${encodeURIComponent(milestoneTitle)}/sprint-review`,
    {},
  );
}

export async function fetchTriageResult(slug: string, id: string): Promise<TriageResultDto | null> {
  const { triage } = await getJson<{ triage: TriageResultDto | null }>(
    `/projects/${slug}/issues/${id}/triage`,
  );
  return triage;
}

export async function setRepoOverride(
  slug: string,
  id: string,
  repo: string,
): Promise<TriageResultDto | null> {
  const { triage } = await postJson<{ triage: TriageResultDto | null }>(
    `/projects/${slug}/issues/${id}/repo-override`,
    { repo },
  );
  return triage ?? null;
}

export async function fetchEvents(
  slug: string,
  id: string,
  signal?: AbortSignal,
): Promise<AgentEventDto[]> {
  const { events } = await getJson<{ events: AgentEventDto[]; hasMore: boolean }>(
    `/projects/${slug}/issues/${id}/events`,
    signal,
  );
  return events;
}

export async function fetchEventsPage(
  slug: string,
  id: string,
  opts?: { limit?: number; before?: number },
  signal?: AbortSignal,
): Promise<{ events: AgentEventDto[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(opts?.limit ?? 100) });
  if (opts?.before != null) params.set('before', String(opts.before));
  return getJson<{ events: AgentEventDto[]; hasMore: boolean }>(
    `/projects/${slug}/issues/${id}/events?${params}`,
    signal,
  );
}

export async function fetchIssueDiff(slug: string, id: string): Promise<IssueDiffDto> {
  return getJson<IssueDiffDto>(`/projects/${slug}/issues/${id}/diff`);
}

export async function approveIssue(
  slug: string,
  id: string,
): Promise<{ ok: true; sha: string; prNumber: number } | { ok: false; conflict: true }> {
  const res = await fetch(`/api/projects/${slug}/issues/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.status === 409) return { ok: false, conflict: true };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `POST /projects/${slug}/issues/${id}/approve failed: ${res.status} ${res.statusText} ${text}`,
    );
  }
  const data = (await res.json()) as { sha: string; prNumber: number };
  return { ok: true, sha: data.sha, prNumber: data.prNumber };
}

export async function rejectIssue(slug: string, id: string, reason: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(`/projects/${slug}/issues/${id}/reject`, { reason });
}

export async function approvePRD(slug: string, id: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(`/projects/${slug}/issues/${id}/approve-prd`, {});
}

export async function rejectPRD(slug: string, id: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(`/projects/${slug}/issues/${id}/reject-prd`, {});
}

export async function revisePRD(
  slug: string,
  id: string,
  concerns: string[],
): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(`/projects/${slug}/issues/${id}/revise-prd`, { concerns });
}

export async function declinePRD(slug: string, id: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(`/projects/${slug}/issues/${id}/decline-prd`, {});
}

export async function proceedToPrd(slug: string, id: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(`/projects/${slug}/issues/${id}/proceed-to-prd`, {});
}

export async function fetchComments(slug: string, id: string): Promise<IssueCommentDto[]> {
  const { comments } = await getJson<{ comments: IssueCommentDto[] }>(
    `/projects/${slug}/issues/${id}/comments`,
  );
  return comments;
}

export async function addComment(slug: string, id: string, body: string): Promise<void> {
  await postJson(`/projects/${slug}/issues/${id}/comment`, { body });
}

export async function setMilestone(
  slug: string,
  id: string,
  milestoneNumber: number | null,
): Promise<void> {
  await postJson(`/projects/${slug}/issues/${id}/set-milestone`, { milestoneNumber });
}

export async function setLabel(
  slug: string,
  id: string,
  group: 'priority' | 'schedule',
  value: string,
): Promise<void> {
  await postJson(`/projects/${slug}/issues/${id}/set-label`, { group, value });
}

export async function resumeIssue(slug: string, id: string): Promise<void> {
  await postJson(`/projects/${slug}/issues/${id}/resume`, {});
}

export async function startFakeRun(
  slug: string,
  id: string,
  skill: 'triage' | 'investigate',
): Promise<void> {
  await postJson(`/projects/${slug}/issues/${id}/fake-run`, { skill });
}

export async function createInboxItem(data: {
  title: string;
  body?: string;
  type: string;
}): Promise<InboxItemDto> {
  const { item } = await postJson<{ item: InboxItemDto }>('/inbox', data);
  return item;
}

export async function fetchInboxItems(): Promise<InboxItemDto[]> {
  const { items } = await getJson<{ items: InboxItemDto[] }>('/inbox');
  return items;
}

export async function promoteInboxItem(
  id: number,
  projectSlug = 'goose-hub-self',
  milestoneNumber?: number | null,
  enhance?: boolean,
): Promise<void> {
  await postJson(`/inbox/${id}/promote`, { projectSlug, milestoneNumber, enhance });
}

export async function deleteInboxItem(id: number): Promise<void> {
  const res = await fetch(`/api/inbox/${id}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE /inbox/${id} failed: ${res.status} ${res.statusText} ${text}`);
  }
}

export async function transitionState(
  slug: string,
  id: string,
  from: string,
  to: string,
): Promise<{ status: number; data: TransitionResult }> {
  const res = await fetch(`/api/projects/${slug}/issues/${id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  const data = (await res.json().catch(() => ({}))) as TransitionResult;
  return { status: res.status, data };
}

export async function fetchRoster(): Promise<PersonaStatDto[]> {
  const { personas } = await getJson<{ personas: PersonaStatDto[] }>('/roster');
  return personas;
}

export async function fetchPersonaNames(): Promise<PersonaNameDto[]> {
  const { names } = await getJson<{ names: PersonaNameDto[] }>('/roster/names');
  return names;
}

export async function fetchPersonaRuns(personaName: string): Promise<PersonaRunDto[]> {
  const { runs } = await getJson<{ runs: PersonaRunDto[] }>(
    `/roster/runs?persona=${encodeURIComponent(personaName)}`,
  );
  return runs;
}

export async function fetchPersonaCandidates(
  personaName: string,
): Promise<ImprovementCandidateDto[]> {
  const { candidates } = await getJson<{ candidates: ImprovementCandidateDto[] }>(
    `/roster/candidates?persona=${encodeURIComponent(personaName)}`,
  );
  return candidates;
}

export async function fetchQualityTrend(
  projectId: string,
  limit = 50,
): Promise<QualityTrendPointDto[]> {
  const { trend } = await getJson<{ trend: QualityTrendPointDto[] }>(
    `/roster/quality-trend?project=${encodeURIComponent(projectId)}&limit=${limit}`,
  );
  return trend;
}

export async function approveCandidateById(id: number): Promise<ImprovementCandidateDto> {
  const { candidate } = await postJson<{ candidate: ImprovementCandidateDto }>(
    `/roster/candidates/${id}/approve`,
    {},
  );
  return candidate;
}

export async function rejectCandidateById(id: number): Promise<ImprovementCandidateDto> {
  const { candidate } = await postJson<{ candidate: ImprovementCandidateDto }>(
    `/roster/candidates/${id}/reject`,
    {},
  );
  return candidate;
}

export async function fetchCostSummary(slug: string): Promise<CostSummaryDto> {
  return getJson<CostSummaryDto>(`/projects/${slug}/costs/summary`);
}

export async function fetchIssueCosts(slug: string, id: string): Promise<WorkItemCostsDto> {
  return getJson<WorkItemCostsDto>(`/projects/${slug}/issues/${id}/costs`);
}

export async function fetchPlaybooks(slug: string): Promise<PlaybookSummaryDto[]> {
  const { playbooks } = await getJson<{ playbooks: PlaybookSummaryDto[] }>(
    `/projects/${slug}/playbooks`,
  );
  return playbooks;
}

export async function fetchPlaybook(slug: string, id: number): Promise<PlaybookDetailDto> {
  const { playbook } = await getJson<{ playbook: PlaybookDetailDto }>(
    `/projects/${slug}/playbooks/${id}`,
  );
  return playbook;
}

export async function createPlaybook(
  slug: string,
  body: { windowSize?: number; dateRange?: { startAt: string; endAt: string } },
): Promise<{ playbookId: number; lifecycleCount: number }> {
  return postJson<{ playbookId: number; lifecycleCount: number }>(
    `/projects/${slug}/playbooks`,
    body,
  );
}

export async function previewBootstrap(repoRef: string): Promise<BootstrapPreviewDto> {
  const res = await fetch('/api/projects/bootstrap/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ repoRef }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /projects/bootstrap/preview failed: ${res.status} ${text}`);
  }
  return (await res.json()) as BootstrapPreviewDto;
}

export async function runBootstrap(repoRef: string, slug?: string): Promise<BootstrapRunDto> {
  const res = await fetch('/api/projects/bootstrap/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ repoRef, slug }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /projects/bootstrap/run failed: ${res.status} ${text}`);
  }
  return (await res.json()) as BootstrapRunDto;
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
    maxRetries: number | null;
    maxBashSeconds: number | null;
    maxIssuesPerDayFromNonOwners: number | null;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
  dbSkillOverrides: Record<
    string,
    {
      maxTurns: number | null;
      maxBudgetUsd: number | null;
      timeoutMs: number | null;
      updatedAt: string;
    }
  >;
  registeredSkills: string[];
}

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

// ─── Model settings ──────────────────────────────────────────────────────────

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface RoleModelDto {
  configRoleModel: { primary: string; fallback: string | null; advisor: string | null } | null;
  dbRoleModel: {
    primaryModel: ModelTier | null;
    fallbackModel: ModelTier | null;
    advisorModel: ModelTier | null;
    updatedAt: string | null;
  } | null;
  dbComplexityOverrides: Record<string, ModelTier>;
}

export interface ProjectModelSettingsDto {
  projectId: string;
  allowHoldoutOverride: boolean;
  roles: Record<string, RoleModelDto>;
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
  },
): Promise<void> {
  await patchJson(`/projects/${slug}/settings/models/${encodeURIComponent(role)}`, patch);
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
