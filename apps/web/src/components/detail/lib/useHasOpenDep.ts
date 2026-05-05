import { fetchIssue, fetchProjects } from '@/lib/api';
import { type DependencyRef, parseDependencies } from '@/lib/dependency-parser';
import type { ProjectSummary, WorkItemDto } from '@/lib/types';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

function resolveDepTarget(
  ref: DependencyRef,
  currentSlug: string,
  currentRepoRef: string,
  projects: ProjectSummary[],
): { slug: string; id: string } | 'unregistered' {
  if (ref.repoRef === null || ref.repoRef === currentRepoRef) {
    return { slug: currentSlug, id: String(ref.issueNumber) };
  }
  const match = projects.find((p) => p.source.repo === ref.repoRef);
  if (match == null) return 'unregistered';
  return { slug: match.slug, id: String(ref.issueNumber) };
}

function isOpenState(state: string): boolean {
  return state !== 'factory:done' && state !== 'factory:archived';
}

/**
 * Returns true if any `depends-on` dep of the given item is still open.
 * Only considers depends-on refs — `blocks` refs are outbound and do not block this issue.
 * Runs unconditionally so the TaskHeader badge is correct on all sections.
 */
export function useHasOpenDep(item: WorkItemDto | undefined, projectSlug: string): boolean {
  const deps = useMemo(
    () => (item != null ? parseDependencies(item.body).filter((d) => d.type === 'depends-on') : []),
    [item],
  );

  const { data: projects = [] } = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: () => fetchProjects(),
    enabled: deps.length > 0,
  });

  const targets = useMemo(
    () =>
      item != null
        ? deps.map((ref) => resolveDepTarget(ref, projectSlug, item.repoRef, projects))
        : [],
    [deps, projectSlug, item, projects],
  );

  const depQueries = useQueries({
    queries: deps.map((ref, i) => {
      const target = targets[i];
      return {
        queryKey: ['dep-issue', ref.repoRef ?? item?.repoRef ?? '', ref.issueNumber],
        queryFn: async () => {
          if (target === 'unregistered') return null;
          return fetchIssue(target.slug, target.id);
        },
        enabled: target !== 'unregistered' && projects.length > 0,
      };
    }),
  });

  return depQueries.some((q) => q.data != null && isOpenState(q.data.state));
}
