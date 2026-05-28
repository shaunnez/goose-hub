import type { InterventionDto, InterventionEventDto } from '@/lib/types';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TimelineContext } from '../../lib/timeline';
import { formatDuration } from '../../lib/timeline';

const EVENT_LABELS: Record<string, string> = {
  open: 'Opened',
  propose: 'Proposed',
  proposalFailed: 'Proposal failed',
  decide: 'Decided',
  markApplying: 'Applying',
  recordApplicationResult: 'Applied',
  verify: 'Verified',
  resolve: 'Resolved',
  reopen: 'Reopened',
  abort: 'Aborted',
  supersede: 'Superseded',
  applyLeaseRecovered: 'Apply lease recovered',
};

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function formatAction(value: string | null): string {
  if (value == null) return 'No action recorded';
  return value.replace(/_/g, ' ');
}

function payloadSummary(event: InterventionEventDto, intervention: InterventionDto): string {
  const payload = event.payload as Record<string, unknown> | null;
  if (event.eventType === 'decide') {
    const actionType =
      typeof payload?.actionType === 'string' ? payload.actionType : intervention.decidedActionType;
    return `${event.actor} chose ${formatAction(actionType)}`;
  }
  if (event.eventType === 'proposalFailed') {
    return typeof payload?.error === 'string' ? payload.error : 'Proposal failed';
  }
  if (event.eventType === 'recordApplicationResult') {
    return event.toStatus === 'FAILED' ? 'Apply failed' : 'Apply completed';
  }
  if (event.eventType === 'reopen') {
    return typeof payload?.reason === 'string' ? payload.reason : intervention.reason;
  }
  return event.toStatus != null ? `${event.fromStatus ?? 'new'} -> ${event.toStatus}` : event.actor;
}

function statusIcon(status: InterventionDto['status']) {
  if (status === 'FAILED') return AlertTriangle;
  if (status === 'RESOLVED' || status === 'VERIFIED' || status === 'APPLIED') return CheckCircle2;
  if (status === 'OPEN') return RotateCcw;
  return ClipboardList;
}

function statusBadge(status: InterventionDto['status']) {
  if (status === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
        Failed
      </span>
    );
  }
  if (status === 'RESOLVED' || status === 'ABORTED' || status === 'SUPERSEDED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
        Closed
      </span>
    );
  }
  if (status === 'OPEN' || status === 'PROPOSED' || status === 'DECIDED' || status === 'APPLYING') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[color:var(--accent)]/10 text-[color:var(--accent)] border border-[color:var(--accent)]/25">
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
      Applied
    </span>
  );
}

export function InterventionGroupWrapper({
  intervention,
  events,
  startedAt,
  endedAt,
  lastEventAt,
  context,
}: {
  intervention: InterventionDto;
  events: InterventionEventDto[];
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  context?: TimelineContext;
}) {
  const [open, setOpen] = useState(false);
  const Icon = statusIcon(intervention.status);
  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const lastMs = lastEventAt != null ? new Date(lastEventAt).getTime() : null;
  const duration =
    startMs != null && (lastMs ?? endMs) != null
      ? formatDuration((lastMs ?? endMs ?? startMs) - startMs)
      : null;

  const expandTick = context?.expandSignal?.tick ?? 0;
  const expandOpen = context?.expandSignal?.open ?? true;
  useEffect(() => {
    if (expandTick === 0) return;
    setOpen(expandOpen);
  }, [expandTick, expandOpen]);

  const metaLine = (
    <span className="text-fg-5 text-[10.5px]">
      {duration != null && <>Lifecycle {duration}</>}
      {startedAt != null && <> &middot; Started {new Date(startedAt).toLocaleTimeString()}</>}
      {lastEventAt != null && <> &middot; Latest {new Date(lastEventAt).toLocaleTimeString()}</>}
    </span>
  );

  return (
    <li
      data-intervention-id={intervention.id}
      className="rounded-md border border-line/70 bg-bg/30"
    >
      <details
        open={open}
        onToggle={(event) => {
          event.stopPropagation();
          setOpen((event.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none flex-wrap">
          <span className="shrink-0">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <Icon size={13} className="shrink-0 text-fg-3" />
          <span className="font-mono uppercase tracking-wider text-[color:var(--accent)] text-[10.5px]">
            {intervention.interventionType.replace(/_/g, ' ')}
          </span>
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="font-mono text-fg-5 text-[10.5px]">#{shortId(intervention.id)}</span>
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="font-mono text-fg-4 text-[10.5px]">{intervention.status}</span>
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="w-[72px] shrink-0 flex justify-start">
            {statusBadge(intervention.status)}
          </span>
          <span className="min-w-[160px] max-w-[260px] truncate text-fg-2">
            {intervention.title}
          </span>
          <span className="flex-1 min-w-0 truncate">{metaLine}</span>
          <span className="ml-auto shrink-0 text-fg-5">{events.length} events</span>
        </summary>
        <div className="px-4 pb-2 text-[12px] text-fg-2">{intervention.reason}</div>
        <ol className="flex flex-col gap-1.5 border-l border-line ml-5 mr-3 mb-3 pl-3">
          {events.map((event) => (
            <li
              key={event.id}
              data-testid={`intervention-event-${event.eventType}`}
              className="text-[12px] text-fg-2"
            >
              <span className="font-mono uppercase text-[10.5px] text-fg-3">
                {EVENT_LABELS[event.eventType] ?? event.eventType}
              </span>
              <span className="text-fg-4 mx-1">·</span>
              <span className="font-mono tnum text-[11px] text-fg-4">
                {new Date(event.createdAt).toLocaleString()}
              </span>
              <span className="text-fg-4 mx-1">·</span>
              <span>{payloadSummary(event, intervention)}</span>
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}
