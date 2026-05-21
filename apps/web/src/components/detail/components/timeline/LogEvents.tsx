import type { AgentEventDto } from '@/lib/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { getPayloadStr } from '../../lib/timeline';

export function AgentLogEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    line?: string;
    metric?: string;
    stream?: string;
    text?: string;
  } | null;
  if (p?.stream === 'telemetry' && p.metric === 'prompt_context_size') return null;
  const line = p?.line ?? p?.text ?? getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <span className="font-mono text-[11.5px] text-fg-2">{line}</span>
    </li>
  );
}

export function AgentLogGroupEvent({ events }: { events: AgentEventDto[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-event-kind="agent.log" className="rounded-md border border-line/50 bg-bg/40 px-4 py-2">
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] text-fg-2 select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {events.length} log lines
        </summary>
        <div className="mt-1 flex flex-col gap-0.5">
          {events.map((ev) => {
            const p = ev.payload as {
              line?: string;
              metric?: string;
              stream?: string;
              text?: string;
            } | null;
            if (p?.stream === 'telemetry' && p.metric === 'prompt_context_size') return null;
            const line = p?.line ?? p?.text ?? getPayloadStr(ev.payload);
            return (
              <div key={ev.id} className="font-mono text-[11.5px] text-fg-2">
                {line}
              </div>
            );
          })}
        </div>
      </details>
    </li>
  );
}
