import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EVENT_KIND_LABEL, groupEvents } from '../lib/timeline';
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

  return (
    <div data-testid="timeline-section" className="px-8 py-6">
      <ol className="flex flex-col gap-3">
        {items.map((item, idx) => renderTimelineItem(item, idx))}
      </ol>
    </div>
  );
}
