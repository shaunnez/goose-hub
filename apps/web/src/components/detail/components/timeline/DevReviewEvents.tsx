import type { AgentEventDto } from '@/lib/types';
import { AlertTriangle, CheckCircle, Clock, GitBranch, SkipForward, XCircle } from 'lucide-react';

type DevReviewPayload = {
  pipelineRunId?: string;
  verdict?: string;
  errorReason?: string;
  iteration?: number;
};

function formatShortId(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return value.length <= 12 ? value : value.slice(0, 8);
}

function PipelineChip({ pipelineRunId }: { pipelineRunId?: string }) {
  const shortId = formatShortId(pipelineRunId);
  if (shortId == null) return null;
  return <span className="font-mono text-fg-4">pipeline {shortId}</span>;
}

function TimelineDot() {
  return <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />;
}

function DevReviewShell({
  event,
  icon,
  title,
  tone = 'line',
  children,
}: {
  event: AgentEventDto;
  icon: React.ReactNode;
  title: string;
  tone?: 'line' | 'success' | 'warning' | 'danger' | 'info';
  children?: React.ReactNode;
}) {
  const borderClass =
    tone === 'success'
      ? 'border-success'
      : tone === 'warning'
        ? 'border-warning'
        : tone === 'danger'
          ? 'border-red-400'
          : tone === 'info'
            ? 'border-info'
            : 'border-line';

  return (
    <li
      data-event-kind={event.kind}
      className={`rounded-md border ${borderClass} bg-bg-elev/60 px-4 py-3`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        {icon}
        <span className="font-mono uppercase tracking-wider">{title}</span>
        <TimelineDot />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {children}
    </li>
  );
}

function DetailRow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] text-fg-3 break-words">{children}</div>;
}

export function DevReviewStartedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<GitBranch size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title="Dev review started"
      tone="info"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {p?.iteration != null && <span>Iteration {p.iteration}</span>}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<CheckCircle size={13} className="shrink-0 text-green-400" />}
      title="Dev review completed"
      tone="success"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {p?.verdict != null && (
          <span className="font-mono text-fg-2">{p.verdict}</span>
        )}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />}
      title="Dev review failed"
      tone="danger"
    >
      <div className="space-y-1">
        {p?.errorReason != null && <DetailRow>{p.errorReason}</DetailRow>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
      </div>
    </DevReviewShell>
  );
}

export function DevReviewErrorEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<AlertTriangle size={13} className="shrink-0 text-amber-400" />}
      title="Dev review error"
      tone="warning"
    >
      <div className="space-y-1">
        {p?.errorReason != null && <DetailRow>{p.errorReason}</DetailRow>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
      </div>
    </DevReviewShell>
  );
}

export function DevReviewBudgetSkippedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<SkipForward size={13} className="shrink-0 text-fg-4" />}
      title="Dev review budget skipped"
      tone="line"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewResponseStartedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<Clock size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title="Response started"
      tone="info"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewResponseCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<CheckCircle size={13} className="shrink-0 text-green-400" />}
      title="Response completed"
      tone="success"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewResponseFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />}
      title="Response failed"
      tone="danger"
    >
      <div className="space-y-1">
        {p?.errorReason != null && <DetailRow>{p.errorReason}</DetailRow>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
      </div>
    </DevReviewShell>
  );
}
