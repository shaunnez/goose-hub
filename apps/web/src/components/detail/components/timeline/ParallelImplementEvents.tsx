import type { AgentEventDto } from '@/lib/types';
import {
  AlertTriangle,
  GitCommit,
  Layers,
  PackageCheck,
  PackageOpen,
  ScrollText,
  TimerOff,
} from 'lucide-react';

type ParallelPayload = {
  wpId?: string;
  iteration?: number;
  wpRunId?: string;
  scratchPath?: string;
  commitSha?: string;
  pipelineRunId?: string;
  wpCount?: number;
  wpIds?: string[];
  errorReason?: string;
  diagnosis?: string;
  elapsedMs?: number;
  failedWpIds?: string[];
  workItemId?: string;
  runId?: string;
};

type SpecPrdContextAttachedPayload = {
  source?: string;
  prdRunId?: string;
  artifactKey?: string;
  inlineSections?: string[];
};

function formatShortId(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return value.length <= 12 ? value : value.slice(0, 8);
}

function formatIssue(value: string | undefined): string | null {
  if (value == null) return null;
  const issue = value.match(/#(\d+)$/)?.[1];
  return issue != null ? `#${issue}` : value;
}

function formatElapsed(ms: number | undefined): string | null {
  if (ms == null) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function PipelineChip({ pipelineRunId }: { pipelineRunId?: string }) {
  const shortId = formatShortId(pipelineRunId);
  if (shortId == null) return null;
  return <span className="font-mono text-fg-4">pipeline {shortId}</span>;
}

function TimelineDot() {
  return <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />;
}

function ParallelEventShell({
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

export function SpecCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ParallelPayload | null;
  const issue = formatIssue(p?.workItemId);

  return (
    <ParallelEventShell
      event={event}
      icon={<ScrollText size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title="Spec authored"
      tone="info"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {issue != null && <span>Work item {issue}</span>}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </ParallelEventShell>
  );
}

export function SpecPrdContextAttachedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as SpecPrdContextAttachedPayload | null;
  const inlineSections = p?.inlineSections ?? [];
  const shortPrdRunId = formatShortId(p?.prdRunId);

  return (
    <ParallelEventShell
      event={event}
      icon={<ScrollText size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title="PRD context attached"
      tone="info"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          {p?.source != null && <span>{p.source}</span>}
          {shortPrdRunId != null && (
            <span className="font-mono text-fg-4">prd {shortPrdRunId}</span>
          )}
          {inlineSections.length > 0 && (
            <span>
              {inlineSections.length} inline section{inlineSections.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {p?.artifactKey != null && (
          <DetailRow>
            Artifact: <span className="font-mono text-fg-2">{p.artifactKey}</span>
          </DetailRow>
        )}
        {inlineSections.length > 0 && (
          <DetailRow>
            Sections: <span className="font-mono text-fg-2">{inlineSections.join(', ')}</span>
          </DetailRow>
        )}
      </div>
    </ParallelEventShell>
  );
}

export function ParallelIterationStartedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ParallelPayload | null;
  const wpIds = p?.wpIds ?? [];
  const count = p?.wpCount ?? wpIds.length;

  return (
    <ParallelEventShell
      event={event}
      icon={<Layers size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title={`Iteration ${p?.iteration ?? '—'} started`}
      tone="info"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        <span>
          {count} work package{count === 1 ? '' : 's'}
        </span>
        {wpIds.length > 0 && <span className="font-mono text-fg-2">{wpIds.join(', ')}</span>}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </ParallelEventShell>
  );
}

export function ParallelWpStartedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ParallelPayload | null;

  return (
    <ParallelEventShell
      event={event}
      icon={<PackageOpen size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title={`${p?.wpId ?? 'Work package'} started`}
      tone="info"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          {p?.iteration != null && <span>Iteration {p.iteration}</span>}
          {formatShortId(p?.wpRunId) != null && (
            <span className="font-mono text-fg-4">run {formatShortId(p?.wpRunId)}</span>
          )}
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
        {p?.scratchPath != null && (
          <DetailRow>
            Scratch workspace:{' '}
            <span className="font-mono text-fg-2">
              {p.scratchPath.replace(/^.*\/workspaces\//, '')}
            </span>
          </DetailRow>
        )}
      </div>
    </ParallelEventShell>
  );
}

export function ParallelWpCommittedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ParallelPayload | null;
  const shortSha = formatShortId(p?.commitSha);

  return (
    <ParallelEventShell
      event={event}
      icon={<GitCommit size={13} className="shrink-0 text-green-400" />}
      title={`${p?.wpId ?? 'Work package'} committed`}
      tone="success"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {shortSha != null && <span className="font-mono text-fg-2">{shortSha}</span>}
        {formatShortId(p?.wpRunId) != null && (
          <span className="font-mono text-fg-4">run {formatShortId(p?.wpRunId)}</span>
        )}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </ParallelEventShell>
  );
}

export function ParallelWpFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ParallelPayload | null;
  const isCommitFailure = event.kind === 'parallel-implement.wp-commit-failed';
  const isLoopCap = event.kind === 'parallel-implement.wp-loop-cap-hit';

  return (
    <ParallelEventShell
      event={event}
      icon={<AlertTriangle size={13} className="shrink-0 text-[color:var(--danger)]" />}
      title={`${p?.wpId ?? 'Work package'} ${
        isCommitFailure ? 'commit failed' : isLoopCap ? 'loop cap hit' : 'failed'
      }`}
      tone="danger"
    >
      <div className="space-y-1">
        {p?.errorReason != null && <DetailRow>{p.errorReason}</DetailRow>}
        {isLoopCap && p?.diagnosis != null && <DetailRow>{p.diagnosis}</DetailRow>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          {formatShortId(p?.wpRunId) != null && (
            <span className="font-mono text-fg-4">run {formatShortId(p?.wpRunId)}</span>
          )}
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
      </div>
    </ParallelEventShell>
  );
}

export function ParallelWpTimeoutEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ParallelPayload | null;
  const elapsed = formatElapsed(p?.elapsedMs);

  return (
    <ParallelEventShell
      event={event}
      icon={<TimerOff size={13} className="shrink-0 text-amber-400" />}
      title={`${p?.wpId ?? 'Work package'} timed out`}
      tone="warning"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {elapsed != null && <span>Elapsed {elapsed}</span>}
        {formatShortId(p?.wpRunId) != null && (
          <span className="font-mono text-fg-4">run {formatShortId(p?.wpRunId)}</span>
        )}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </ParallelEventShell>
  );
}

export function ParallelExhaustedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ParallelPayload | null;
  const failed = p?.failedWpIds ?? [];

  return (
    <ParallelEventShell
      event={event}
      icon={<PackageCheck size={13} className="shrink-0 text-[color:var(--danger)]" />}
      title="Parallel implement exhausted"
      tone="danger"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {failed.length > 0 && (
          <span>
            Failed package{failed.length === 1 ? '' : 's'}:{' '}
            <span className="font-mono text-fg-2">{failed.join(', ')}</span>
          </span>
        )}
        {formatShortId(p?.runId) != null && (
          <span className="font-mono text-fg-4">run {formatShortId(p?.runId)}</span>
        )}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </ParallelEventShell>
  );
}
