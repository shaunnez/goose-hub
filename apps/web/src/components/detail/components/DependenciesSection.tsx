import { fetchIssue, fetchProjects } from '@/lib/api';
import { type DependencyRef, parseDependencies } from '@/lib/dependency-parser';
import type { ProjectSummary, WorkItemDto } from '@/lib/types';
import { useQueries, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

interface DependenciesSectionProps {
  item: WorkItemDto;
  projectSlug: string;
}

function resolveDepTarget(
  ref: DependencyRef,
  currentSlug: string,
  currentRepoRef: string | null,
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

export function DependenciesSection({ item, projectSlug }: DependenciesSectionProps) {
  const deps = useMemo(() => parseDependencies(item.body), [item.body]);

  const { data: projects = [] } = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: () => fetchProjects(),
    enabled: deps.length > 0,
  });

  const targets = useMemo(
    () => deps.map((ref) => resolveDepTarget(ref, projectSlug, item.repoRef, projects)),
    [deps, projectSlug, item.repoRef, projects],
  );

  const depQueries = useQueries({
    queries: deps.map((ref, i) => {
      const target = targets[i];
      return {
        queryKey: ['dep-issue', ref.repoRef ?? item.repoRef, ref.issueNumber],
        queryFn: async () => {
          if (target === 'unregistered') return null;
          return fetchIssue(target.slug, target.id);
        },
        enabled: target !== 'unregistered',
      };
    }),
  });

  if (deps.length === 0) return null;

  return (
    <div data-testid="dependencies-section" className="mt-6">
      <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
        Dependencies ({deps.length})
      </h3>
      <div className="flex flex-col gap-2">
        {deps.map((ref, i) => {
          const target = targets[i];
          const query = depQueries[i];
          const depItem = query?.data ?? null;
          const isUnregistered = target === 'unregistered';
          const isLoading = query?.isLoading ?? false;
          const open = depItem != null && isOpenState(depItem.state);

          const refLabel =
            ref.repoRef != null ? `${ref.repoRef}#${ref.issueNumber}` : `#${ref.issueNumber}`;

          return (
            <div
              key={`${ref.repoRef ?? ''}#${ref.issueNumber}`}
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-line bg-bg-elev"
              data-testid={`dep-row-${ref.issueNumber}`}
            >
              <span className="mt-0.5 shrink-0">
                {isUnregistered ? (
                  <AlertTriangle
                    size={13}
                    style={{ color: 'var(--warning)' }}
                    aria-label="unregistered"
                  />
                ) : isLoading ? (
                  <Circle size={13} className="text-fg-4 animate-pulse" aria-label="loading" />
                ) : open ? (
                  <Circle size={13} className="text-fg-3" aria-label="open" />
                ) : (
                  <CheckCircle2 size={13} style={{ color: 'var(--success)' }} aria-label="closed" />
                )}
              </span>

              <div className="flex-1 min-w-0">
                {isUnregistered ? (
                  <div>
                    <span className="font-mono text-[12px] text-fg-3">{refLabel}</span>
                    <span className="ml-2 text-[11px] text-fg-4 italic">
                      unregistered repo — register it in Goose Hub to resolve
                    </span>
                  </div>
                ) : depItem != null ? (
                  <div className="flex items-baseline gap-2 min-w-0">
                    {typeof target === 'object' ? (
                      <Link
                        to={`/projects/${target.slug}/items/${target.id}`}
                        className="font-mono text-[12px] text-accent hover:underline shrink-0"
                      >
                        {refLabel}
                      </Link>
                    ) : (
                      <span className="font-mono text-[12px] text-fg-3 shrink-0">{refLabel}</span>
                    )}
                    <span className="text-[12.5px] text-fg truncate">{depItem.title}</span>
                    <span
                      className="text-[11px] shrink-0"
                      style={{ color: open ? 'var(--fg-3)' : 'var(--success)' }}
                    >
                      {open ? 'open' : 'closed'}
                    </span>
                  </div>
                ) : (
                  <span className="font-mono text-[12px] text-fg-4">{refLabel}</span>
                )}
              </div>

              <span
                className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${
                  ref.type === 'blocks' ? 'border-line text-fg-3' : 'border-line text-fg-4'
                }`}
              >
                {ref.type === 'blocks' ? 'blocks' : 'dep'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
