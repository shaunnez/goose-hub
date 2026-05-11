import type { AgentEventDto } from '@/lib/types';
import { Activity, AlertTriangle, CheckCircle, Clock, Layers, XCircle } from 'lucide-react';

export function SwarmHeartbeatEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { parentRunId?: string; scoutCount?: number } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <Activity size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">
          Swarm heartbeat
          {p?.scoutCount != null ? ` · ${p.scoutCount} scouts running` : ''}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function SwarmScoutCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    scoutName?: string;
    findingsCount?: number;
    decisionSummariesCount?: number;
  } | null;
  const name = p?.scoutName ?? '—';
  const findings = p?.findingsCount ?? 0;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">Scout completed: {name}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="mt-1 text-[11.5px] text-fg-3">
        {findings} finding{findings !== 1 ? 's' : ''}
      </div>
    </li>
  );
}

export function SwarmScoutFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { scoutName?: string; errorReason?: string } | null;
  const name = p?.scoutName ?? '—';
  const reason = p?.errorReason ?? 'unknown';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        <span className="font-mono uppercase tracking-wider">Scout failed: {name}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[11.5px] text-fg-2 break-words">{reason}</div>
    </li>
  );
}

export function SwarmScoutTimeoutEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { scoutName?: string; scoutTimeoutMs?: number } | null;
  const name = p?.scoutName ?? '—';
  const ms = p?.scoutTimeoutMs;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <Clock size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">
          Scout timeout: {name}
          {ms != null ? ` (${ms / 1000}s)` : ''}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function SwarmWaveEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    scoutCount?: number;
    okCount?: number;
    failedScouts?: string[];
  } | null;
  const ok = p?.okCount ?? 0;
  const total = p?.scoutCount ?? 0;
  const failed = p?.failedScouts ?? [];

  const isHalted = event.kind === 'swarm.wave-halted';
  const isIncomplete = event.kind === 'swarm.wave-incomplete';

  const label = isHalted ? 'Wave halted' : isIncomplete ? 'Wave incomplete' : 'Wave completed';
  const Icon = isHalted ? AlertTriangle : isIncomplete ? AlertTriangle : Layers;
  const iconClass = isHalted
    ? 'shrink-0 text-[color:var(--danger)]'
    : isIncomplete
      ? 'shrink-0 text-amber-400'
      : 'shrink-0 text-green-400';

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Icon size={13} className={iconClass} />
        <span className="font-mono uppercase tracking-wider">{label}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[11.5px] text-fg-3">
        {ok}/{total} scouts ok
        {failed.length > 0 && <span className="ml-2 text-fg-4">· failed: {failed.join(', ')}</span>}
      </div>
    </li>
  );
}
