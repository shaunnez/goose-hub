export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: { kind: string; repo: string };
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
  schedule: string;
  exec: string;
  dependsOn: string[];
  blocks: string[];
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
  createdAt: string;
}

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

export async function fetchEvents(slug: string, id: string): Promise<AgentEventDto[]> {
  const { events } = await getJson<{ events: AgentEventDto[] }>(
    `/projects/${slug}/issues/${id}/events`,
  );
  return events;
}

export interface TransitionResult {
  ok?: boolean;
  error?: string;
  legalTargets?: string[];
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
