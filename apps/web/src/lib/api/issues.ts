import type {
  AgentEventDto,
  EngineeringSpecDto,
  IssueCommentDto,
  IssueDiffDto,
  TransitionResult,
  TriageResultDto,
  WorkItemCostsDto,
  WorkItemDto,
} from '../types.js';
import { getJson, patchJson, postJson } from './client.js';

export async function fetchIssues(slug: string, opts?: { all?: boolean }): Promise<WorkItemDto[]> {
  const qs = opts?.all ? '?all=true' : '';
  const { items } = await getJson<{ items: WorkItemDto[] }>(`/projects/${slug}/issues${qs}`);
  return items;
}

export async function fetchIssue(slug: string, id: string): Promise<WorkItemDto> {
  const { item } = await getJson<{ item: WorkItemDto }>(`/projects/${slug}/issues/${id}`);
  return item;
}

export async function fetchEngineeringSpec(
  slug: string,
  id: string,
): Promise<EngineeringSpecDto | null> {
  const { spec } = await getJson<{ spec: EngineeringSpecDto | null }>(
    `/projects/${slug}/issues/${id}/spec`,
  );
  return spec;
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

export async function fetchIssueCosts(slug: string, id: string): Promise<WorkItemCostsDto> {
  return getJson<WorkItemCostsDto>(`/projects/${slug}/issues/${id}/costs`);
}

export async function approveIssue(
  slug: string,
  id: string,
): Promise<{ ok: true; sha: string; prNumber: number } | { ok: false; conflict: true }> {
  const res = await fetch(`/projects/${slug}/issues/${id}/approve`, {
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

export async function setMilestone(
  slug: string,
  id: string,
  milestoneNumber: number | null,
): Promise<void> {
  await postJson(`/projects/${slug}/issues/${id}/set-milestone`, { milestoneNumber });
}
