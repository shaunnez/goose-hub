import type { AgentEventDto } from '@/lib/types';
import { FileCode } from 'lucide-react';

export function AgentImplementCompleteEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    filesWritten?: number;
    testsWritten?: number;
    confidence?: string;
  } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1.5 text-[11px] text-fg-3">
        <FileCode size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Implement complete</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex gap-4 text-[11.5px] text-fg-3">
        {p?.filesWritten != null && (
          <span>
            <span className="text-fg-2 font-medium">{p.filesWritten}</span> files
          </span>
        )}
        {p?.testsWritten != null && (
          <span>
            <span className="text-fg-2 font-medium">{p.testsWritten}</span> tests
          </span>
        )}
        {p?.confidence != null && (
          <span>
            confidence: <span className="text-fg-2 font-medium">{p.confidence}</span>
          </span>
        )}
      </div>
    </li>
  );
}
