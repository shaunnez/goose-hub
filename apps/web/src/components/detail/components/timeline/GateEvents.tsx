import type { AgentEventDto } from '@/lib/types';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';

export function GateAwaitingHumanEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { gate?: string; reason?: string; runDisposition?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <AlertCircle size={13} className="shrink-0 text-[color:var(--warning)]" />
        <span className="font-mono uppercase tracking-wider">Gate — awaiting human</span>
        {p?.gate != null && (
          <span className="rounded border border-yellow-500/20 bg-yellow-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-yellow-400">
            {p.gate}
          </span>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.reason != null && <p className="mt-1.5 text-[12px] text-fg-2">{p.reason}</p>}
    </li>
  );
}

export function GateApprovedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string; prNumber?: number } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">Approved</span>
        {p?.prNumber != null && <span className="font-mono text-fg-2">#{p.prNumber}</span>}
        {p?.source != null && <span className="font-mono text-fg-2">via {p.source}</span>}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function GateRejectedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string; reason?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <XCircle size={13} className="shrink-0 text-red-400" />
        <span className="font-mono uppercase tracking-wider">Rejected</span>
        {p?.source != null && <span className="font-mono text-fg-2">via {p.source}</span>}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.reason != null && <p className="mt-1.5 text-[12px] text-fg-2">{p.reason}</p>}
    </li>
  );
}
