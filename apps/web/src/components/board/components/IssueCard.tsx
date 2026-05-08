import { Pill } from '@/components/ui/pill';
import { fetchIssueCosts } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PRIORITY_COLOR, STATE_LABEL } from '@/lib/constants';
import type { WorkItemCostsDto, WorkItemDto } from '@/lib/types';
import { getPersonaInitials, usePersonaMap } from '@/lib/usePersonaMap';
import { ageLabel, formatCost } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Ban, GitFork } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Shorten a repo-qualified dep ref to issue-number-only when it's in the same repo. */
function shortRef(ref: string, repoRef: string): string {
  const prefix = `${repoRef}#`;
  if (ref.startsWith(prefix)) return `#${ref.split('#').pop()}`;
  // Already short (e.g. "#292" from same-repo shorthand in body)
  if (ref.startsWith('#')) return ref;
  return ref;
}

export function IssueCard({
  item,
  projectSlug,
  projectColor,
}: {
  item: WorkItemDto;
  projectSlug: string;
  projectColor?: string;
}) {
  const ageStr = ageLabel(item.createdAt);
  const personaMap = usePersonaMap();
  const initials = getPersonaInitials(personaMap, item.lastPersonaId);
  const isBlocked = item.schedule === 'blocked-by';

  // Per-card fetch; TanStack Query dedupes by key so the issue detail page
  // shares the same cache. Boards with many cards trigger N requests on mount —
  // tracked as a follow-up to add a project-level summary endpoint.
  const { data: costs } = useQuery<WorkItemCostsDto>({
    queryKey: ['issue-costs', projectSlug, item.externalId],
    queryFn: () => fetchIssueCosts(projectSlug, item.externalId),
    staleTime: 60_000,
  });
  const costLabel =
    costs == null
      ? '—'
      : costs.rows.length === 0
        ? '$—'
        : formatCost(costs.totalUsd, costs.hasEstimated ? 'estimated' : 'exact');

  const blockedTooltip = isBlocked
    ? `Blocked by: ${item.dependsOn
        .map((r) => {
          const short = shortRef(r, item.repoRef);
          const title = item.dependsOnTitles?.[r];
          return title ? `${short} — ${title}` : short;
        })
        .join(', ')}`
    : undefined;
  return (
    <Link
      to={`/projects/${projectSlug}/items/${item.externalId}`}
      data-testid="issue-card"
      data-issue-number={item.externalId}
      data-state={item.state}
      data-schedule={item.schedule}
      data-project={projectColor != null ? projectSlug : undefined}
      className={cn(
        'block rounded-md border border-line bg-bg-elev px-3 py-2.5',
        'hover:border-line-2 hover:bg-bg-hover transition-colors',
        isBlocked && 'border-[color:var(--danger)]/40',
      )}
      style={projectColor != null ? { borderLeft: `3px solid ${projectColor}` } : undefined}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: PRIORITY_COLOR[item.priority] ?? 'var(--fg-3)' }}
        />
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-3">
          #{item.externalId}
        </span>
        <span className="grow" />
        <span className="font-mono tnum text-[10.5px] text-fg-2">{ageStr}</span>
      </div>
      <div className="text-[12.5px] text-fg leading-snug font-medium mb-2">
        {item.title.length <= 55 ? item.title : `${item.title.slice(0, 54).trimEnd()}…`}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {isBlocked && (
          <Pill
            tone="danger"
            className="h-5 text-[10.5px] px-2 gap-1"
            title={blockedTooltip}
            data-testid="blocked-indicator"
          >
            <Ban size={9} aria-hidden />
            Blocked
          </Pill>
        )}
        <Pill tone="default" className="h-5 text-[10.5px] px-2">
          {STATE_LABEL[item.state] ?? item.state}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.type}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.priority}
        </Pill>
        {item.milestoneTitle != null && (
          <Pill
            tone="default"
            className="h-5 text-[10.5px] px-2 font-mono"
            data-testid="milestone-badge"
          >
            {item.milestoneTitle}
          </Pill>
        )}
        {item.prdChildren != null && item.prdChildren.length > 0 && (
          <span className="inline-flex items-center gap-1">
            {item.prdChildren.map((n) => (
              <Link
                key={n}
                to={`/projects/${projectSlug}/items/${n}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 font-mono text-[10px] text-accent border border-accent/30 rounded px-1 py-0.5 hover:border-accent/60 hover:bg-accent/5 transition-colors"
                title={`Child issue #${n}`}
              >
                <GitFork size={9} aria-hidden />#{n}
              </Link>
            ))}
          </span>
        )}
        {item.prdParent != null && (
          <Link
            to={`/projects/${projectSlug}/items/${item.prdParent}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 font-mono text-[10px] text-fg-3 border border-line rounded px-1 py-0.5 hover:border-line-2 hover:text-fg-2 transition-colors"
            title={`From PRD #${item.prdParent}`}
          >
            <GitFork size={9} aria-hidden />
            PRD #{item.prdParent}
          </Link>
        )}
        {initials != null && (
          <span
            title={item.lastPersonaId ?? undefined}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[color:var(--accent)]/15 text-[color:var(--accent)] font-mono text-[9px] font-bold shrink-0"
            data-testid="persona-initials"
          >
            {initials}
          </span>
        )}
        <span
          className="ml-auto font-mono text-[10.5px] text-fg-2"
          title={
            costs == null
              ? 'Loading…'
              : costs.rows.length === 0
                ? 'No agent runs recorded yet'
                : `${costs.rows.length} run${costs.rows.length === 1 ? '' : 's'}`
          }
          data-testid="issue-card-cost"
        >
          {costLabel}
        </span>
      </div>
    </Link>
  );
}
