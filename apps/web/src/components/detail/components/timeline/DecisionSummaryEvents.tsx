import type { AgentEventDto } from '@/lib/types';
import { ChevronRight, Sparkles } from 'lucide-react';
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
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
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
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <details>
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] select-none">
          <ChevronRight size={12} />
          <span className="text-[color:var(--accent)] shrink-0" title="Live decision marker">
            💭
          </span>
          {kind != null && (
            <span
              data-testid="decision-kind-chip-live"
              className="font-mono text-[9.5px] tracking-wider px-1 py-[1px] rounded bg-bg-elev-2 text-[color:var(--accent)] shrink-0"
            >
              {kind}
            </span>
          )}
          <span className="truncate max-w-[460px]">{summary}</span>
        </summary>
        <div className="mt-1.5 text-[11px] text-fg-2 font-mono tnum pl-4">
          {new Date(event.createdAt).toLocaleString()}
        </div>
      </details>
    </li>
  );
}
