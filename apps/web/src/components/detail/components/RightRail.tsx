import { fetchEvents } from '@/lib/api';
import { logger } from '@/lib/logger';
import type { AgentEventDto } from '@/lib/types';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface RightRailProps {
  projectSlug: string;
  id: string;
  workItemId: string;
}

const ALL_EVENT_KINDS = [
  'state.transitioned',
  'milestone.activated',
  'agent.spawned',
  'agent.decision-summary',
  'agent.terminated',
  'agent.log',
  'gate.awaiting-human',
  'system.note',
  'manual.action',
  'agent.run-started',
  'agent.run-completed',
  'agent.run-failed',
  'agent.tool-call',
  'tool.stdout-truncated',
  'tool.timeout',
  'agent.fallback-triggered',
  'agent.triage-complete',
  'agent.implement-complete',
  'pr.opened',
  'evidence.no-spec-declared',
  'evidence.posted',
  'evidence.post-failed',
];

const MAX_TOOL_CALLS = 10;

function ToolCallEntry({ event }: { event: AgentEventDto }) {
  const [open, setOpen] = useState(false);
  const p = event.payload as { tool_name?: string; tool_input?: unknown } | null;
  const toolName = p?.tool_name ?? 'unknown';
  const inputStr = p?.tool_input != null ? JSON.stringify(p.tool_input, null, 2) : '';
  return (
    <div className="border-b border-line/50 last:border-0 py-1.5">
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11px] text-fg-4 select-none">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Wrench size={10} className="shrink-0" />
          <span className="flex-1 truncate">{toolName}</span>
          <span className="text-fg-5 text-[10px] ml-1 shrink-0">
            {new Date(event.createdAt).toLocaleTimeString()}
          </span>
        </summary>
        {inputStr.length > 0 && (
          <pre className="mt-1 text-[10px] font-mono text-fg-4 whitespace-pre-wrap overflow-x-auto max-h-32">
            {inputStr}
          </pre>
        )}
      </details>
    </div>
  );
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
    for (const kind of ALL_EVENT_KINDS) {
      es.addEventListener(kind, handler as EventListener);
    }
    es.onmessage = handler;
    es.onerror = () => {
      // EventSource auto-reconnects on error
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [projectSlug, workItemId]);

  const toolCalls = events.filter((e) => e.kind === 'agent.tool-call').slice(-MAX_TOOL_CALLS);

  const terminatedWithOutput = [...events]
    .reverse()
    .find(
      (e) =>
        (e.kind === 'agent.run-completed' || e.kind === 'agent.terminated') &&
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
      className="w-[320px] shrink-0 flex flex-col border-l border-line bg-bg-elev/40"
    >
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-4">Live activity</div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {toolCalls.length > 0 && (
          <div className="rounded-md border border-line bg-bg p-3">
            <div className="text-fg-2 mb-2 text-[11.5px] font-medium">
              Tool calls
              <span className="ml-1.5 text-fg-4 font-normal">({toolCalls.length})</span>
            </div>
            <div className="text-[11px]">
              {toolCalls.map((e) => (
                <ToolCallEntry key={e.id} event={e} />
              ))}
            </div>
          </div>
        )}
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
          toolCalls.length === 0 && (
            <div className="rounded-md border border-line bg-bg p-3 text-[12px] text-fg-3 leading-relaxed">
              <div className="text-fg-2 mb-1.5">No agent output yet</div>
              <p className="text-[11.5px] text-fg-3">
                Output appears here when an agent run completes.
              </p>
            </div>
          )
        )}
      </div>
      <div className="px-4 py-3 border-t border-line text-[10.5px] uppercase tracking-wider text-fg-4">
        Personas
      </div>
      <div className="px-4 pb-4 text-[11.5px] text-fg-3">
        Persona roster available in the Roster tab.
      </div>
    </aside>
  );
}
