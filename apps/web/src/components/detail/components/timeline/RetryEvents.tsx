import type { AgentEventDto } from '@/lib/types';
import { AlertTriangle, ArrowRight } from 'lucide-react';

type RetryEscalatedPayload = {
  stage?: string;
  maxRetries?: number;
  runId?: string;
  retryRunId?: string;
  skill?: string;
  fromModel?: string;
  toModel?: string;
  reason?: string;
};

function formatShortId(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return value.length <= 12 ? value : value.slice(0, 8);
}

function TimelineDot() {
  return <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />;
}

export function AgentRetryEscalatedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as RetryEscalatedPayload | null;
  const shortRunId = formatShortId(p?.runId ?? event.runId ?? undefined);
  const shortRetryRunId = formatShortId(p?.retryRunId);
  const isRetryCap = p?.maxRetries != null;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">
          {isRetryCap ? 'Retry cap reached' : 'Retry escalated'}
        </span>
        <TimelineDot />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {p?.stage != null && <span>Stage {p.stage}</span>}
        {p?.skill != null && <span>{p.skill}</span>}
        {p?.maxRetries != null && <span>Max retries {p.maxRetries}</span>}
        {shortRunId != null && <span className="font-mono text-fg-4">run {shortRunId}</span>}
      </div>
      {(p?.fromModel != null || p?.toModel != null || shortRetryRunId != null) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-3">
          {p?.fromModel != null && <span className="font-mono">{p.fromModel}</span>}
          {(p?.fromModel != null || p?.toModel != null) && (
            <ArrowRight size={12} className="shrink-0 text-fg-4" />
          )}
          {p?.toModel != null && <span className="font-mono">{p.toModel}</span>}
          {shortRetryRunId != null && (
            <span className="font-mono text-fg-4">retry {shortRetryRunId}</span>
          )}
        </div>
      )}
      {p?.reason != null && <div className="mt-1 text-[11.5px] text-fg-3">{p.reason}</div>}
    </li>
  );
}
