import { fetchEvents } from '@/lib/api';
import { logger } from '@/lib/logger';
import type { AgentEventDto } from '@/lib/types';
import { useEffect, useRef, useState } from 'react';

interface RightRailProps {
  projectSlug: string;
  id: string;
  workItemId: string;
}

export function RightRail({ projectSlug, id, workItemId }: RightRailProps) {
  const [events, setEvents] = useState<AgentEventDto[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEvents(projectSlug, id)
      .then((list) => {
        if (cancelled) return;
        setEvents(list);
      })
      .catch((err: unknown) => {
        logger.error('RightRail: failed to fetch initial events', { err: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug, id]);

  // Live updates via SSE filtered to this work item.
  useEffect(() => {
    if (!workItemId) return;
    const url = `/events?projectId=${encodeURIComponent(projectSlug)}&workItemId=${encodeURIComponent(workItemId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as AgentEventDto;
        setEvents((prev) => {
          if (prev.find((e) => e.id === parsed.id) != null) return prev;
          return [...prev, parsed];
        });
      } catch (err) {
        logger.warn('RightRail: failed to parse SSE event', { err: String(err) });
      }
    };
    es.addEventListener('agent.terminated', handler as EventListener);
    es.onmessage = handler;
    es.onerror = () => {
      // EventSource auto-reconnects on error
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [projectSlug, workItemId]);

  // Find the latest agent.terminated event with a non-null output field.
  const terminatedWithOutput = [...events]
    .reverse()
    .find(
      (e) =>
        e.kind === 'agent.terminated' &&
        e.payload != null &&
        typeof e.payload === 'object' &&
        'output' in (e.payload as object) &&
        (e.payload as { output: unknown }).output != null,
    );

  const output =
    terminatedWithOutput != null
      ? (terminatedWithOutput.payload as { output: unknown }).output
      : null;

  return (
    <aside
      data-testid="detail-right-rail"
      className="w-[260px] shrink-0 flex flex-col border-l border-line bg-bg-elev/40"
    >
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-4">Live activity</div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 text-[12px] text-fg-3 leading-relaxed">
        {output != null ? (
          <div className="rounded-md border border-line bg-bg p-3">
            <div className="text-fg-2 mb-2 text-[11.5px] font-medium">Agent output</div>
            <details open>
              <summary className="cursor-pointer text-[11px] text-fg-3 mb-1.5">
                View structured output
              </summary>
              <pre className="mt-2 text-[10.5px] font-mono text-fg-2 whitespace-pre-wrap overflow-x-auto">
                {JSON.stringify(output, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <div className="rounded-md border border-line bg-bg p-3">
            <div className="text-fg-2 mb-1.5">No agent runs yet</div>
            <p className="text-[11.5px] text-fg-3">
              The runtime that spawns agents arrives in M4. Once it does, this rail will stream tool
              calls and decision summaries from the running personas.
            </p>
          </div>
        )}
      </div>
      <div className="px-4 py-3 border-t border-line text-[10.5px] uppercase tracking-wider text-fg-4">
        Personas
      </div>
      <div className="px-4 pb-4 text-[11.5px] text-fg-3">Persona roster lights up in M5.</div>
    </aside>
  );
}
