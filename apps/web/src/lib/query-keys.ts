import type { QueryClient } from '@tanstack/react-query';
import type { InterventionStatus } from './types.js';

export const interventionKeys = {
  project: (slug: string, status?: InterventionStatus[]) =>
    ['interventions', 'project', slug, status?.join(',') ?? 'all'] as const,
  issue: (slug: string, id: string, status?: InterventionStatus[]) =>
    ['interventions', 'issue', slug, id, status?.join(',') ?? 'all'] as const,
  detail: (id: string) => ['interventions', 'detail', id] as const,
  timeline: (slug: string, id: string) => ['intervention-timeline', slug, id] as const,
  legalTargets: (slug: string, id: string) => ['legal-targets', slug, id] as const,
};

export async function invalidateInterventionDecision(
  queryClient: QueryClient,
  input: { projectSlug: string; issueId: string; interventionId: string },
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['issue', input.projectSlug, input.issueId] }),
    queryClient.invalidateQueries({ queryKey: ['issues', input.projectSlug] }),
    queryClient.invalidateQueries({ queryKey: ['events', input.projectSlug, input.issueId] }),
    queryClient.invalidateQueries({ queryKey: interventionKeys.detail(input.interventionId) }),
    queryClient.invalidateQueries({
      queryKey: ['interventions', 'project', input.projectSlug],
    }),
    queryClient.invalidateQueries({
      queryKey: ['interventions', 'issue', input.projectSlug, input.issueId],
    }),
    queryClient.invalidateQueries({
      queryKey: interventionKeys.timeline(input.projectSlug, input.issueId),
    }),
    queryClient.invalidateQueries({
      queryKey: interventionKeys.legalTargets(input.projectSlug, input.issueId),
    }),
  ]);
}
