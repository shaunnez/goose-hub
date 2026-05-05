import type {
  AgentEventDto,
  CostSummaryDto,
  ImprovementCandidateDto,
  InboxItemDto,
  IssueCommentDto,
  IssueDiffDto,
  MilestoneDto,
  PersonaNameDto,
  PersonaRunDto,
  PersonaStatDto,
  ProjectConfigDto,
  ProjectSummary,
  TransitionResult,
  TriageResultDto,
  WorkItemCostsDto,
  WorkItemDto,
} from './types';

export type {
  ProjectConfigDto,
  ProjectSummary,
  WorkItemDto,
  IssueCommentDto,
  IssueDiffDto,
  MilestoneDto,
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
} from './types';

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

export async function fetchProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  const { projects } = await getJson<{ projects: ProjectSummary[] }>('/projects', signal);
  return projects;
}

export async function fetchProjectConfigs(signal?: AbortSignal): Promise<ProjectConfigDto[]> {
  const { configs } = await getJson<{ configs: ProjectConfigDto[] }>('/projects/configs', signal);
  return configs;
}

export async function fetchIssues(slug: string): Promise<WorkItemDto[]> {
  const { items } = await getJson<{ items: WorkItemDto[] }>(`/projects/${slug}/issues`);
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
  const { events } = await getJson<{ events: AgentEventDto[] }>(
    `/projects/${slug}/issues/${id}/events`,
    signal,
  );
  return events;
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
