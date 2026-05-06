import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { EVENT_KIND_LABEL, groupEvents } from '../lib/timeline';
import type { RenderItem } from '../lib/timeline';
import { SectionEmptyState } from './SectionEmptyState';
import { renderTimelineItem } from './TimelineEvents';

export type { RenderItem } from '../lib/timeline';

interface TimelineSectionProps {
  projectSlug: string;
  id: string;
  workItemId: string;
}

export function TimelineSection({ projectSlug, id, workItemId }: TimelineSectionProps) {
  const [events, setEvents] = useState<AgentEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
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
    fetchEvents(projectSlug, id, controller.signal)
      .then((list) => {
        if (cancelled) return;
        // Server returns ascending; render newest first.
        const sorted = [...list].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setEvents(sorted);
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

  // Live updates via SSE filtered to this work item.
  useEffect(() => {
    const url = `/events?projectId=${encodeURIComponent(projectSlug)}&workItemId=${encodeURIComponent(workItemId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as AgentEventDto;
        setEvents((prev) => {
          if (prev.find((e) => e.id === parsed.id) != null) return prev;
          return [parsed, ...prev];
        });
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
  }, [projectSlug, workItemId]);

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
        <SectionEmptyState
          icon={Clock}
          title="No timeline events yet."
          subtitle="Events are recorded as the issue moves through the pipeline."
        />
      </div>
    );
  }

  const items = groupEvents(events);
  const hasRunGroups = items.some((item: RenderItem) => item.kind === 'run-group');
  const latestRunId = items.find((item: RenderItem) => item.kind === 'run-group')?.runId ?? null;
  const context = { slug: projectSlug, issueId: id, latestRunId, runCosts, expandSignal };

  const sendSignal = (open: boolean) => setExpandSignal((prev) => ({ tick: prev.tick + 1, open }));

  return (
    <div data-testid="timeline-section" className="px-8 py-6">

      {/* Section header */}
      <div className=" gap-3 mb-3">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">09. Timeline</div>
        <div className="flex justify-between items-baseline">
          <h2 className="text-[17px] font-semibold text-fg leading-snug">
            Repo candidates &amp; classification
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
    </div>
  );
}
