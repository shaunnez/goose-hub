import type { AgentEventDto } from '@/lib/types';
import { Radio, Sparkles } from 'lucide-react';
import { getPayloadStr } from '../../lib/timeline';

export function AgentDecisionSummaryEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { summary?: string; kind?: string; step?: string } | null;
  const summary = p?.summary ?? getPayloadStr(event.payload);
  // #466 — kind is the post-migration field. step was used pre-migration.
  // Fall back to step so legacy events still render a label rather than blank.
  const rawKind =
    typeof p?.kind === 'string' ? p.kind : typeof p?.step === 'string' ? p.step : null;
  const kind = rawKind != null && rawKind.length > 0 ? rawKind : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-black bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Sparkles size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Decision summary</span>
        {kind != null && (
          <span
            data-testid="decision-kind-chip"
            className="font-mono text-[10px] tracking-wider px-1.5 py-[1px] rounded bg-bg-elev-2 text-[color:var(--accent)]"
          >
            {kind}
          </span>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">{summary}</div>
    </li>
  );
}

export function AgentDecisionSummaryLiveEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { summary?: string; kind?: string; step?: string } | null;
  const summary = p?.summary ?? getPayloadStr(event.payload);
  // #466 — kind is the post-migration field. step was used pre-migration.
  // Fall back to step so legacy events still render a label rather than blank.
  const rawKind =
    typeof p?.kind === 'string' ? p.kind : typeof p?.step === 'string' ? p.step : null;
  const kind = rawKind != null && rawKind.length > 0 ? rawKind : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-3 py-2"
    >
      <div className="flex items-start gap-2">
        <Radio size={12} className="mt-[2px] shrink-0 text-[color:var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-fg-3">
            <span className="uppercase tracking-wider">Live decision</span>
            {kind != null && (
              <span
                data-testid="decision-kind-chip-live"
                className="shrink-0 rounded bg-bg-elev-2 px-1.5 py-[1px] font-mono text-[9.5px] tracking-wider text-[color:var(--accent)]"
              >
                {kind}
              </span>
            )}
            <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-4" />
            <span className="tnum">{new Date(event.createdAt).toLocaleTimeString()}</span>
          </div>
          <div className="mt-1 text-[12px] leading-snug text-fg-2">{summary}</div>
        </div>
      </div>
    </li>
  );
}
