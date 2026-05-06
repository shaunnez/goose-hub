import type { AgentEventDto } from '@/lib/types';
import { CheckCircle, XCircle } from 'lucide-react';

export function ReviewCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { verdict?: string; confidence?: number } | null;
  const verdict = p?.verdict ?? 'unknown';
  const isApproved = verdict === 'approved';
  const confidencePct = p?.confidence != null ? `${Math.round(p.confidence * 100)}%` : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        {isApproved ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        )}
        <span className="font-mono uppercase tracking-wider">Review</span>
        <span
          className={`font-mono font-medium ${isApproved ? 'text-green-400' : 'text-[color:var(--danger)]'}`}
        >
          {verdict}
        </span>
        {confidencePct != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="font-mono text-fg-3">{confidencePct} confidence</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}
