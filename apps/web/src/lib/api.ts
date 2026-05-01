import type {
  AgentEventDto,
  InboxItemDto,
  IssueCommentDto,
  MilestoneDto,
  ProjectSummary,
  TransitionResult,
  TriageResultDto,
  WorkItemDto,
} from './types';

export type {
  ProjectSummary,
  WorkItemDto,
  IssueCommentDto,
  MilestoneDto,
  AgentEventDto,
  TransitionResult,
  InboxItemDto,
  TriageResultDto,
} from './types';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
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

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const { projects } = await getJson<{ projects: ProjectSummary[] }>('/projects');
  return projects;
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

export async function fetchMilestones(slug: string): Promise<MilestoneDto[]> {
  const { milestones } = await getJson<{ milestones: MilestoneDto[] }>(
    `/projects/${slug}/milestones`,
  );
  return milestones;
}

export async function fetchActiveMilestone(
  slug: string,
): Promise<{ milestoneNumber: number | null; source: string }> {
  return getJson<{ milestoneNumber: number | null; source: string }>(
    `/projects/${slug}/active-milestone`,
  );
}

export async function setActiveMilestone(
  slug: string,
  milestoneNumber: number | null,
): Promise<void> {
  await postJson(`/projects/${slug}/active-milestone`, { milestoneNumber });
}

export async function fetchTriageResult(
  slug: string,
  id: string,
): Promise<TriageResultDto | null> {
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

export async function fetchEvents(slug: string, id: string): Promise<AgentEventDto[]> {
  const { events } = await getJson<{ events: AgentEventDto[] }>(
    `/projects/${slug}/issues/${id}/events`,
  );
  return events;
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
}): Promise<void> {
  await postJson('/inbox', data);
}

export async function fetchInboxItems(): Promise<InboxItemDto[]> {
  const { items } = await getJson<{ items: InboxItemDto[] }>('/inbox');
  return items;
}

export async function promoteInboxItem(id: number, projectSlug = 'goose-hub-self'): Promise<void> {
  await postJson(`/inbox/${id}/promote`, { projectSlug });
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
