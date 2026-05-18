import { fetchEventsPage } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { EVENT_KIND_LABEL, groupEvents } from '../lib/timeline';
import type { RenderItem } from '../lib/timeline';
import { SectionEmptyState } from './SectionEmptyState';
import { renderTimelineItem } from './TimelineEvents';

export type { RenderItem } from '../lib/timeline';

const PAGE_SIZE = 100;

interface TimelineSectionProps {
  projectSlug: string;
  id: string;
  workItemId: string;
}

export function TimelineSection({ projectSlug, id, workItemId }: TimelineSectionProps) {
  const [events, setEvents] = useState<AgentEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Set to max event id after initial REST fetch; triggers SSE open with lastEventId.
  const [sseReadyAfter, setSseReadyAfter] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const queryClient = useQueryClient();
  const { byRun: runCosts } = useIssueCostsBreakdown(projectSlug, id);
  const [expandSignal, setExpandSignal] = useState<{ tick: number; open: boolean }>({
    tick: 0,
    open: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSseReadyAfter(null);
    fetchEventsPage(projectSlug, id, { limit: PAGE_SIZE }, controller.signal)
      .then(({ events: list, hasMore: more }) => {
        if (cancelled) return;
        setEvents(list);
        setHasMore(more);
        setCursor(list.at(-1)?.id);
        // Open SSE from here — skip replay of events we already have.
        setSseReadyAfter(list[0]?.id ?? 0);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectSlug, id]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || cursor == null) return;
    setLoadingMore(true);
    try {
      const { events: older, hasMore: more } = await fetchEventsPage(projectSlug, id, {
        limit: PAGE_SIZE,
        before: cursor,
      });
      setEvents((prev) => [...prev, ...older]);
      setHasMore(more);
      setCursor(older.at(-1)?.id);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, cursor, projectSlug, id]);

  // Live updates via SSE. Opens only after initial REST fetch so lastEventId
  // skips the replay of events already loaded — no double-fetch.
  useEffect(() => {
    if (sseReadyAfter === null || !workItemId) return;
    const params = new URLSearchParams({
      projectId: projectSlug,
      workItemId,
      lastEventId: String(sseReadyAfter),
    });
    const es = new EventSource(`/events?${params}`);
    eventSourceRef.current = es;
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as AgentEventDto;
        setEvents((prev) => {
          if (prev.find((e) => e.id === parsed.id) != null) return prev;
          return [parsed, ...prev];
        });
        if (parsed.kind === 'agent.run-completed' || parsed.kind === 'agent.run-failed') {
          void queryClient.invalidateQueries({ queryKey: ['issue-costs', projectSlug, id] });
        }
      } catch {
        // ignore
      }
    };
    // Default 'message' fires for events without an `event:` field; named
    // events fire on the type. Subscribe to all known kinds.
    for (const kind of Object.keys(EVENT_KIND_LABEL)) {
      es.addEventListener(kind, handler as EventListener);
    }
    es.onmessage = handler;
    es.onerror = () => {
      // Connection blip; EventSource auto-reconnects.
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [projectSlug, workItemId, sseReadyAfter, queryClient, id]);

  if (loading) {
    return <div className="px-8 py-6 text-fg-3">Loading timeline…</div>;
  }

  if (error != null) {
    return (
      <div className="px-8 py-6 text-[color:var(--danger)]">Couldn't load timeline: {error}</div>
    );
  }
  if (events.length === 0) {
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

  const items = groupEvents(events);
  const flattenRunItems = (renderItems: RenderItem[]): RenderItem[] =>
    renderItems.flatMap((item: RenderItem): RenderItem[] =>
      item.kind === 'phase-group' || item.kind === 'investigation-phase'
        ? flattenRunItems(item.items)
        : [item],
    );
  const allRunItems = flattenRunItems(items);
  const hasRunGroups = allRunItems.some((item: RenderItem) => item.kind === 'run-group');
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
          {hasRunGroups && (
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

      {hasMore && (
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
