import type { AgentEventDto } from '@/lib/types';
import { AlertCircle, CheckCircle, ExternalLink, Info } from 'lucide-react';

export function EvidenceNoSpecEvent({ event }: { event: AgentEventDto }) {
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] ">
        <Info size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">No evidence spec declared</span>
      </div>
    </li>
  );
}

export function EvidencePostedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { commentUrl?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">Evidence posted</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.commentUrl != null && (
        <a
          href={p.commentUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[11.5px] text-[color:var(--accent)] hover:underline"
        >
          <ExternalLink size={11} />
          {p.commentUrl}
        </a>
      )}
    </li>
  );
}

export function EvidencePostFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { error?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <AlertCircle size={13} className="shrink-0 text-yellow-400" />
        <span className="font-mono uppercase tracking-wider">Evidence post failed</span>
        {p?.error != null && <span className="text-fg-3">: {p.error}</span>}
      </div>
    </li>
  );
}

export function EvidenceSkippedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { reason?: string } | null;
  const label =
    event.kind === 'evidence.playwright-repro-skipped'
      ? 'Playwright repro skipped'
      : 'Evidence post skipped';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <Info size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">{label}</span>
        {p?.reason != null && <span className="text-fg-3">: {p.reason}</span>}
      </div>
    </li>
  );
}
