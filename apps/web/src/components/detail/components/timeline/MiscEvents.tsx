import type { AgentEventDto } from '@/lib/types';
import { ArrowRight, Cpu, Info, Target, User } from 'lucide-react';
import { EVENT_KIND_LABEL, getPayloadStr } from '../../lib/timeline';

export function ManualActionEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { action?: string } | null;
  const action = p?.action ?? getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <User size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Manual: {action}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function MilestoneActivatedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { milestoneNumber?: number | string } | null;
  const num = p?.milestoneNumber ?? getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <Target size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Milestone set to {num}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function StateTransitionedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { from?: string; to?: string; by?: string } | null;
  const summary =
    p?.from != null && p?.to != null
      ? `${p.from} → ${p.to}${p.by != null ? ` (by ${p.by})` : ''}`
      : getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <ArrowRight size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">State transitioned</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">{summary}</div>
    </li>
  );
}

export function SystemNoteEvent({ event }: { event: AgentEventDto }) {
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Info size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Note</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">{getPayloadStr(event.payload)}</div>
    </li>
  );
}

export function AgentModelSelectedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    skill?: string;
    role?: string;
    selectedTier?: string;
    reason?: string;
  } | null;
  const tier = p?.selectedTier ?? '—';
  const reason = p?.reason ?? '—';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Cpu size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Model selected</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {tier}
        <span className="text-fg-4 mx-1">·</span>
        {reason}
      </div>
    </li>
  );
}

export function FallbackEvent({ event }: { event: AgentEventDto }) {
  const payloadStr =
    typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload, null, 2);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <span className="font-mono uppercase tracking-wider">
          {EVENT_KIND_LABEL[event.kind] ?? event.kind}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <pre className="mt-1 text-[11px] font-mono text-fg-2 whitespace-pre-wrap overflow-x-auto">
        {payloadStr}
      </pre>
    </li>
  );
}
