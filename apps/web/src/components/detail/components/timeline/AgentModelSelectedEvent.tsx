import type { AgentEventDto } from '@/lib/types';
import { Cpu } from 'lucide-react';

export function AgentModelSelectedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    role?: string;
    selectedTier?: string;
    reason?: string;
  } | null;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1.5 text-[11px] text-fg-3">
        <Cpu size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Model selected</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex gap-4 text-[11.5px] text-fg-3">
        {p?.role != null && (
          <span>
            role: <span className="text-fg-2 font-medium">{p.role}</span>
          </span>
        )}
        {p?.selectedTier != null && (
          <span>
            tier: <span className="text-fg-2 font-medium">{p.selectedTier}</span>
          </span>
        )}
        {p?.reason != null && (
          <span>
            reason: <span className="text-fg-2 font-medium">{p.reason}</span>
          </span>
        )}
      </div>
    </li>
  );
}
