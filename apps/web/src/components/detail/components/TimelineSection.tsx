import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useEffect, useRef, useState } from 'react';

interface TimelineSectionProps {
  projectSlug: string;
  id: string;
  workItemId: string;
}

const STATE_LABEL: Record<string, string> = {
  'state.transitioned': 'State transitioned',
  'milestone.activated': 'Milestone activated',
  'agent.spawned': 'Agent spawned',
  'agent.decision-summary': 'Decision summary',
  'agent.terminated': 'Agent terminated',
  'gate.awaiting-human': 'Gate — awaiting human',
  'system.note': 'Note',
};

function summarizePayload(kind: string, payload: unknown): string {
  if (kind === 'state.transitioned' && payload != null && typeof payload === 'object') {
    const p = payload as { from?: string; to?: string; by?: string };
    if (p.from != null && p.to != null) {
      return `${p.from} → ${p.to}${p.by != null ? ` (by ${p.by})` : ''}`;
    }
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

export function TimelineSection({ projectSlug, id, workItemId }: TimelineSectionProps) {
  const [events, setEvents] = useState<AgentEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEvents(projectSlug, id)
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
    for (const kind of Object.keys(STATE_LABEL)) {
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
      <div data-testid="timeline-section" className="px-8 py-10 text-center text-fg-3 text-[13px]">
        No timeline events yet. Transition the state or wait for the orchestrator (M4+) to populate
        this view.
      </div>
    );
  }

  return (
    <div data-testid="timeline-section" className="px-8 py-6 max-w-[920px]">
      <ol className="flex flex-col gap-3">
        {events.map((event) => (
          <li
            key={event.id}
            data-event-kind={event.kind}
            className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
          >
            <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
              <span className="font-mono uppercase tracking-wider">
                {STATE_LABEL[event.kind] ?? event.kind}
              </span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
              <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
            </div>
            <div className="text-[12.5px] text-fg-2">
              {summarizePayload(event.kind, event.payload)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
