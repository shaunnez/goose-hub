import type { AgentEventDto } from '@/lib/types';
import type { QueryClient } from '@tanstack/react-query';

export function upsertIssueEvent(
  queryClient: QueryClient,
  projectSlug: string,
  issueId: string,
  event: AgentEventDto,
): void {
  queryClient.setQueryData<AgentEventDto[]>(['events', projectSlug, issueId], (existing) => {
    // Avoid seeding a partial SSE-only cache before the full events query has loaded.
    if (existing == null) return existing;
    if (existing.some((candidate) => candidate.id === event.id)) return existing;
    return [event, ...existing].sort((a, b) => b.id - a.id);
  });
}
