import { fetchEventsPage, fetchIntervention, fetchIssueInterventions } from '@/lib/api';
import type { InterventionDetailDto } from '@/lib/api/interventions';
import { interventionKeys } from '@/lib/query-keys';
import type { AgentEventDto } from '@/lib/types';
import { isIssueTimelineEvent } from '@goose-hub/core/event-stream/issue-timeline.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { mergeIssueEvents } from '../lib/live-events';
import { groupTimelineEventsByCanonicalSection } from '../lib/timeline';
import type { RenderItem } from '../lib/timeline';
import { SectionEmptyState } from './SectionEmptyState';
import { renderTimelineItem } from './TimelineEvents';

export type { RenderItem } from '../lib/timeline';

const PAGE_SIZE = 200;

interface TimelineSectionProps {
  projectSlug: string;
  id: string;
  workItemId?: string;
  itemState?: string;
}

export function TimelineSection({ projectSlug, id, itemState }: TimelineSectionProps) {
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const queryClient = useQueryClient();
  const {
    data: events = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['events', projectSlug, id],
    queryFn: async ({ signal }) => {
      const { events: list, hasMore: more } = await fetchEventsPage(
        projectSlug,
        id,
        { limit: PAGE_SIZE },
        signal,
      );
      setHasMore(more);
      return mergeIssueEvents(
        queryClient.getQueryData<AgentEventDto[]>(['events', projectSlug, id]),
        list,
      );
    },
  });
  const { byRun: runCosts } = useIssueCostsBreakdown(projectSlug, id);
  const { data: interventionDetails = [], isLoading: interventionsLoading } = useQuery({
    queryKey: interventionKeys.timeline(projectSlug, id),
    queryFn: async (): Promise<InterventionDetailDto[]> => {
      const interventions = await fetchIssueInterventions(projectSlug, id);
      return Promise.all(interventions.map((intervention) => fetchIntervention(intervention.id)));
    },
  });
  const [expandSignal, setExpandSignal] = useState<{ tick: number; open: boolean }>({
    tick: 0,
    open: true,
  });

  const loadMore = useCallback(async () => {
    const cursor = events.at(-1)?.id;
    if (!hasMore || loadingMore || cursor == null) return;
    setLoadingMore(true);
    try {
      const { events: older, hasMore: more } = await fetchEventsPage(projectSlug, id, {
        limit: PAGE_SIZE,
        before: cursor,
      });
      queryClient.setQueryData<AgentEventDto[]>(['events', projectSlug, id], (prev) =>
        mergeIssueEvents(prev, older),
      );
      setHasMore(more);
    } finally {
      setLoadingMore(false);
    }
  }, [events, hasMore, loadingMore, projectSlug, id, queryClient]);

  const visibleEvents = events.filter(isIssueTimelineEvent);

  if (isLoading || (visibleEvents.length === 0 && interventionsLoading)) {
    return <div className="px-8 py-6 text-fg-3">Loading timeline…</div>;
  }

  if (error != null) {
    return (
      <div className="px-8 py-6 text-[color:var(--danger)]">
        Couldn't load timeline: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  const items = groupTimelineEventsByCanonicalSection(
    visibleEvents,
    interventionDetails,
    itemState,
  );
  if (items.length === 0) {
    return (
      <div data-testid="timeline-section" className="px-8 py-6">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">10. Timeline</div>
        <h2 className="text-[17px] font-semibold text-fg leading-snug mb-5">
          Live timeline of agents
        </h2>
        <SectionEmptyState
          icon={Clock}
          title="No timeline events yet."
          subtitle="Events are recorded as the issue moves through the pipeline."
        />
      </div>
    );
  }

  const flattenRunItems = (renderItems: RenderItem[]): RenderItem[] =>
    renderItems.flatMap((item: RenderItem): RenderItem[] =>
      item.kind === 'timeline-section' ||
      item.kind === 'phase-group' ||
      item.kind === 'investigation-phase' ||
      item.kind === 'review-group'
        ? flattenRunItems(item.items)
        : [item],
    );
  const allRunItems = flattenRunItems(items);
  const hasExpandableGroups =
    allRunItems.some(
      (item: RenderItem) => item.kind === 'run-group' || item.kind === 'intervention-group',
    ) || items.some((item: RenderItem) => item.kind === 'timeline-section');
  const latestRunId =
    allRunItems.find((item: RenderItem) => item.kind === 'run-group')?.runId ?? null;
  const context = { slug: projectSlug, issueId: id, latestRunId, runCosts, expandSignal };

  const sendSignal = (open: boolean) => setExpandSignal((prev) => ({ tick: prev.tick + 1, open }));

  return (
    <div data-testid="timeline-section" className="px-8 py-6">
      {/* Section header */}
      <div className=" gap-3 mb-3">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">10. Timeline</div>
        <div className="flex justify-between items-baseline">
          <h2 className="text-[17px] font-semibold text-fg leading-snug">
            Live timeline of agents
          </h2>
          {hasExpandableGroups && (
            <div className="flex gap-3 mb-3">
              <button
                type="button"
                data-testid="timeline-expand-all"
                onClick={() => sendSignal(true)}
                className="font-mono text-[11px] uppercase tracking-wider hover:text-fg-2 transition-colors"
              >
                Expand all
              </button>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-5" />
              <button
                type="button"
                data-testid="timeline-collapse-all"
                onClick={() => sendSignal(false)}
                className="font-mono text-[11px] uppercase tracking-wider hover:text-fg-2 transition-colors"
              >
                Collapse all
              </button>
            </div>
          )}
        </div>
      </div>

      <ol className="flex flex-col gap-3">
        {items.map((item: RenderItem, idx: number) => renderTimelineItem(item, idx, context))}
      </ol>

      {hasMore && visibleEvents.length >= PAGE_SIZE && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="h-7 px-4 rounded-md border border-line text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? 'Loading…' : 'Load older events'}
          </button>
        </div>
      )}
    </div>
  );
}
