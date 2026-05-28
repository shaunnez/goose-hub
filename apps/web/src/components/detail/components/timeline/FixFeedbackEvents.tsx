import type { AgentEventDto } from '@/lib/types';
import {
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
  GitBranch,
  GitPullRequest,
} from 'lucide-react';
import type { ComponentType } from 'react';

type FixFeedbackPayload = {
  filesWritten?: number;
  testsWritten?: number;
  confidence?: string;
  repairMode?: string;
  repairCycle?: number;
  sourceFailureKind?: string;
  sourceFailureRunId?: string;
  devRunId?: string;
  reason?: string;
  sourceFeedback?: string;
  prNumber?: number;
  branch?: string;
  branchSource?: string;
  affectedWpIds?: string[];
  testsRun?: {
    command?: string;
    paths?: string[];
  };
};

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
}

function formatSlug(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .map((part) => (part.toLowerCase() === 'qa' ? 'QA' : part))
    .join(' ');
}

function shortRunId(value: string): string {
  return value.slice(0, 8);
}

function feedbackLines(value: string | undefined): string[] {
  if (value == null) return [];
  return stripAnsi(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function TimelineDot() {
  return <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />;
}

type FixFeedbackVariant = {
  fallbackTitle: string;
  legacyTitle: (cycle: number) => string;
  borderClass: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  iconClass: string;
};

const completeVariant: FixFeedbackVariant = {
  fallbackTitle: 'Fix feedback complete',
  legacyTitle: (cycle) => `Legacy Repair Cycle ${cycle}`,
  borderClass: 'border-success bg-bg-elev/60',
  Icon: ClipboardCheck,
  iconClass: 'text-green-400',
};

const skippedVariant: FixFeedbackVariant = {
  fallbackTitle: 'Fix feedback skipped',
  legacyTitle: (cycle) => `Legacy Repair Cycle ${cycle} Skipped`,
  borderClass: 'border-yellow-500/30 bg-yellow-500/5',
  Icon: AlertTriangle,
  iconClass: 'text-yellow-400',
};

function FixFeedbackEventCard({
  event,
  variant,
}: {
  event: AgentEventDto;
  variant: FixFeedbackVariant;
}) {
  const p = event.payload as FixFeedbackPayload | null;
  const command = p?.testsRun?.command;
  const paths = p?.testsRun?.paths ?? [];
  const sourceFeedbackLines = feedbackLines(p?.sourceFeedback);
  const title =
    p?.repairMode === 'legacy-implement' && p.repairCycle != null
      ? variant.legacyTitle(p.repairCycle)
      : variant.fallbackTitle;
  const Icon = variant.Icon;
  return (
    <li
      data-event-kind={event.kind}
      className={`rounded-md border ${variant.borderClass} px-4 py-3`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Icon size={13} className={`shrink-0 ${variant.iconClass}`} />
        <span className="font-mono uppercase tracking-wider">{title}</span>
        <TimelineDot />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {p?.repairMode === 'legacy-implement' && <span>legacy implement repair</span>}
        {p?.sourceFailureKind != null && (
          <span>{formatSlug(p.sourceFailureKind)} source failure</span>
        )}
        {p?.reason != null && <span>{formatSlug(p.reason)}</span>}
        {p?.filesWritten != null && (
          <span>
            {p.filesWritten} file{p.filesWritten === 1 ? '' : 's'} written
          </span>
        )}
        {p?.testsWritten != null && (
          <span>
            {p.testsWritten} test{p.testsWritten === 1 ? '' : 's'} written
          </span>
        )}
        {p?.confidence != null && <span>{p.confidence} confidence</span>}
        {p?.affectedWpIds != null && p.affectedWpIds.length > 0 && (
          <span>{p.affectedWpIds.join(', ')}</span>
        )}
      </div>
      {(p?.prNumber != null || p?.branch != null || p?.branchSource != null) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-3">
          {p?.prNumber != null && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <GitPullRequest size={12} className="shrink-0 text-fg-4" />
              {`PR #${p.prNumber}`}
            </span>
          )}
          {p?.branch != null && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <GitBranch size={12} className="shrink-0 text-fg-4" />
              <span className="font-mono break-all">{p.branch}</span>
            </span>
          )}
          {p?.branchSource != null && <span>{`branch source ${p.branchSource}`}</span>}
        </div>
      )}
      {(p?.sourceFailureRunId != null || p?.devRunId != null) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-3">
          {p.sourceFailureRunId != null && (
            <span className="font-mono">{`source run ${shortRunId(p.sourceFailureRunId)}`}</span>
          )}
          {p.devRunId != null && (
            <span className="font-mono">{`dev run ${shortRunId(p.devRunId)}`}</span>
          )}
        </div>
      )}
      {sourceFeedbackLines.length > 0 && (
        <div className="mt-2 rounded border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase text-yellow-400">
            <AlertTriangle size={11} className="shrink-0" />
            Source feedback
          </div>
          <div className="flex flex-col gap-1">
            {sourceFeedbackLines.map((line) => (
              <div
                key={line}
                className="font-mono text-[10.5px] text-fg-3 whitespace-pre-wrap break-words"
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
      {command != null && (
        <div className="mt-2 flex items-start gap-2 text-[11.5px] text-fg-3">
          <CheckCircle size={12} className="mt-0.5 shrink-0 text-green-400" />
          <span className="font-mono break-words">{command}</span>
        </div>
      )}
      {paths.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {paths.map((path) => (
            <span key={path} className="font-mono text-[11px] text-fg-3">
              {path}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export function AgentFixFeedbackCompleteEvent({ event }: { event: AgentEventDto }) {
  return <FixFeedbackEventCard event={event} variant={completeVariant} />;
}

export function AgentFixFeedbackSkippedEvent({ event }: { event: AgentEventDto }) {
  return <FixFeedbackEventCard event={event} variant={skippedVariant} />;
}
