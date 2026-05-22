import { interventionKeys } from '@/lib/query-keys';
import type { AgentEventDto, WorkItemDto } from '@/lib/types';
import { isIssueTimelineEvent } from '@goose-hub/core/event-stream/issue-timeline.js';
import type { QueryClient } from '@tanstack/react-query';

type StateTransitionPayload = {
  to?: unknown;
};

type FetchEventsPage = (
  projectSlug: string,
  issueId: string,
  opts: { limit?: number; after?: number },
) => Promise<{ events: AgentEventDto[]; hasMore: boolean }>;

export function mergeIssueEvents(
  existing: AgentEventDto[] | undefined,
  incoming: AgentEventDto[],
): AgentEventDto[] {
  const byId = new Map<number, AgentEventDto>();
  for (const event of existing ?? []) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

export function upsertIssueEvent(
  queryClient: QueryClient,
  projectSlug: string,
  issueId: string,
  event: AgentEventDto,
): void {
  queryClient.setQueryData<AgentEventDto[]>(['events', projectSlug, issueId], (existing) => {
    if (existing?.some((candidate) => candidate.id === event.id)) return existing;
    return mergeIssueEvents(existing, [event]);
  });
}

export function latestTransitionState(events: AgentEventDto[] | undefined): string | null {
  const latest = (events ?? []).find((event) => event.kind === 'state.transitioned');
  const payload = latest?.payload as StateTransitionPayload | null | undefined;
  return typeof payload?.to === 'string' ? payload.to : null;
}

export function applyLatestEventState<T extends WorkItemDto>(
  item: T,
  events: AgentEventDto[] | undefined,
): T {
  const state = latestTransitionState(events);
  return state != null && item.state !== state ? { ...item, state } : item;
}

export function patchIssueStateFromTransition(
  queryClient: QueryClient,
  projectSlug: string,
  issueId: string,
  event: AgentEventDto,
): void {
  if (event.kind !== 'state.transitioned') return;
  const payload = event.payload as StateTransitionPayload | null | undefined;
  if (typeof payload?.to !== 'string') return;

  queryClient.setQueryData<WorkItemDto>(['issue', projectSlug, issueId], (existing) =>
    existing == null ? existing : { ...existing, state: payload.to as string },
  );
  queryClient.setQueryData<WorkItemDto[]>(['issues', projectSlug], (existing) =>
    existing?.map((item) =>
      item.externalId === issueId ? { ...item, state: payload.to as string } : item,
    ),
  );
}

export function applyIssueTimelineEvent(
  queryClient: QueryClient,
  projectSlug: string,
  issueId: string,
  event: AgentEventDto,
): boolean {
  if (!isIssueTimelineEvent(event)) return false;

  upsertIssueEvent(queryClient, projectSlug, issueId, event);

  if (event.kind === 'state.transitioned') {
    patchIssueStateFromTransition(queryClient, projectSlug, issueId, event);
    void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, issueId] });
    void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    const payload = event.payload as {
      interventionId?: string;
      causedByInterventionId?: string;
    } | null;
    if (payload?.interventionId != null || payload?.causedByInterventionId != null) {
      void queryClient.invalidateQueries({
        queryKey: interventionKeys.timeline(projectSlug, issueId),
      });
    }
  }

  if (
    event.kind === 'grill.question-posted' ||
    event.kind === 'gate.awaiting-human' ||
    event.kind === 'gate.approved' ||
    event.kind === 'gate.rejected' ||
    event.kind === 'prd.drafted' ||
    event.kind === 'evidence.posted' ||
    event.kind === 'evidence.post-failed' ||
    event.kind === 'pr.opened' ||
    event.kind === 'pr.merged' ||
    event.kind === 'merge.conflict'
  ) {
    void queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, issueId] });
  }

  if (event.kind === 'spec.completed') {
    void queryClient.invalidateQueries({ queryKey: ['spec', projectSlug, issueId] });
    void queryClient.invalidateQueries({
      queryKey: ['acceptance-contract', projectSlug, issueId],
    });
  }

  if (
    event.kind === 'agent.run-completed' ||
    event.kind === 'agent.run-failed' ||
    event.kind === 'agent.budget-exceeded' ||
    event.kind === 'agent.discovery-budget-exceeded' ||
    event.kind === 'project.budget-exceeded'
  ) {
    void queryClient.invalidateQueries({ queryKey: ['issue-costs', projectSlug, issueId] });
  }

  return true;
}

export async function backfillIssueTimelineEvents(input: {
  queryClient: QueryClient;
  projectSlug: string;
  issueId: string;
  fetchPage: FetchEventsPage;
  limit: number;
}): Promise<void> {
  const cached =
    input.queryClient.getQueryData<AgentEventDto[]>(['events', input.projectSlug, input.issueId]) ??
    [];
  let after = cached[0]?.id;
  if (after == null) return;

  for (;;) {
    const page = await input.fetchPage(input.projectSlug, input.issueId, {
      after,
      limit: input.limit,
    });
    if (page.events.length === 0) break;

    const chronological = page.events
      .filter(isIssueTimelineEvent)
      .sort((left, right) => left.id - right.id);
    for (const event of chronological) {
      applyIssueTimelineEvent(input.queryClient, input.projectSlug, input.issueId, event);
    }

    const newestSeen = page.events.reduce((max, event) => Math.max(max, event.id), after);
    if (!page.hasMore || newestSeen <= after) break;
    after = newestSeen;
  }
}
