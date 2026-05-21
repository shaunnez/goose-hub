import type { AgentEventDto } from '@/lib/types';
import { AlertTriangle, CheckCircle, GitMerge, XCircle } from 'lucide-react';

type ReviewWavePayload = {
  round?: number;
  error?: string;
  roundFindingsCount?: number;
  newCriticalCount?: number;
  anyNeedsHuman?: boolean;
  anyNeedsFix?: boolean;
  totalRounds?: number;
  reason?: string;
  escalationReason?: string;
  unconvergedFindingsCount?: number;
  slotIndex?: number;
  slotModel?: string;
  promptVariant?: string;
  verdict?: string;
  confidence?: number;
  findingsCount?: number;
  criteriaChecks?: unknown[];
};

function TimelineDot() {
  return <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-4" />;
}

function decodeJsonStringFragment(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/\n/g, '\\n')}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"');
  }
}

function summarizeReviewWaveError(error: string | undefined): string {
  if (error == null || error.trim().length === 0) return 'Reviewer wave failed before completion.';

  const messageMatch = error.match(/"message"\s*:\s*"((?:\\.|[^"])*)"/);
  if (messageMatch?.[1] != null) return decodeJsonStringFragment(messageMatch[1]);

  const firstError = error.split('; Codex reported an error')[0]?.trim();
  return firstError != null && firstError.length > 0 ? firstError : error.trim();
}

function ReviewEventShell({
  event,
  icon,
  title,
  tone,
  round,
  children,
}: {
  event: AgentEventDto;
  icon: React.ReactNode;
  title: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  round?: number | null;
  children?: React.ReactNode;
}) {
  const borderClass =
    tone === 'success'
      ? 'border-success'
      : tone === 'warning'
        ? 'border-warning'
        : tone === 'danger'
          ? 'border-red-400'
          : 'border-info';

  return (
    <li
      data-event-kind={event.kind}
      className={`rounded-md border ${borderClass} bg-bg-elev/60 px-4 py-3`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
        {icon}
        <span className="font-mono uppercase tracking-wider">{title}</span>
        {round != null && (
          <>
            <TimelineDot />
            <span className="font-mono text-fg-3">round {round}</span>
          </>
        )}
        <TimelineDot />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {children}
    </li>
  );
}

function MetricRow({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string | number;
  tone?: 'normal' | 'warning' | 'danger';
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-[color:var(--danger)]'
      : tone === 'warning'
        ? 'text-amber-300'
        : 'text-fg-2';
  return (
    <span>
      {label} <span className={`font-mono ${valueClass}`}>{value}</span>
    </span>
  );
}

export function ReviewWaveCompletedEvent({ event }: { event: AgentEventDto }) {
  const payload = event.payload as ReviewWavePayload | null;
  const needsHuman = payload?.anyNeedsHuman === true;
  const needsFix = payload?.anyNeedsFix === true;

  return (
    <ReviewEventShell
      event={event}
      icon={<CheckCircle size={13} className="shrink-0 text-green-400" />}
      title="Review wave completed"
      tone={needsHuman || needsFix ? 'warning' : 'success'}
      round={payload?.round}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-3">
        {typeof payload?.roundFindingsCount === 'number' && (
          <MetricRow label="Findings" value={payload.roundFindingsCount} />
        )}
        {typeof payload?.newCriticalCount === 'number' && (
          <MetricRow
            label="New critical"
            value={payload.newCriticalCount}
            tone={payload.newCriticalCount > 0 ? 'danger' : 'normal'}
          />
        )}
        {needsHuman && <MetricRow label="Verdict" value="needs-human" tone="danger" />}
        {!needsHuman && needsFix && <MetricRow label="Verdict" value="needs-fix" tone="warning" />}
        {!needsHuman && !needsFix && <MetricRow label="Verdict" value="clear" />}
      </div>
    </ReviewEventShell>
  );
}

export function ReviewWaveFailedEvent({ event }: { event: AgentEventDto }) {
  const payload = event.payload as ReviewWavePayload | null;
  const summary = summarizeReviewWaveError(payload?.error);

  return (
    <ReviewEventShell
      event={event}
      icon={<XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />}
      title="Review wave failed"
      tone="danger"
      round={payload?.round}
    >
      <div className="text-[12.5px] text-fg-2 break-words">{summary}</div>
    </ReviewEventShell>
  );
}

export function ReviewConvergedEvent({ event }: { event: AgentEventDto }) {
  const payload = event.payload as ReviewWavePayload | null;
  return (
    <ReviewEventShell
      event={event}
      icon={<GitMerge size={13} className="shrink-0 text-green-400" />}
      title="Review converged"
      tone="success"
    >
      <div className="text-[12.5px] text-fg-2">
        {typeof payload?.totalRounds === 'number'
          ? `Converged after ${payload.totalRounds} round(s).`
          : 'Review findings converged.'}
      </div>
    </ReviewEventShell>
  );
}

export function ReviewEscalatedEvent({ event }: { event: AgentEventDto }) {
  const payload = event.payload as ReviewWavePayload | null;
  const reason = payload?.escalationReason ?? payload?.reason ?? 'Reviewer escalation required.';

  return (
    <ReviewEventShell
      event={event}
      icon={<AlertTriangle size={13} className="shrink-0 text-amber-400" />}
      title="Review escalated"
      tone="warning"
      round={payload?.round}
    >
      <div className="space-y-1">
        <div className="text-[12.5px] text-fg-2 break-words">{reason}</div>
        {payload?.reason != null && payload.escalationReason != null && (
          <div className="text-[11.5px] text-fg-3">
            Reason <span className="font-mono text-fg-2">{payload.reason}</span>
          </div>
        )}
        {typeof payload?.unconvergedFindingsCount === 'number' && (
          <div className="text-[11.5px] text-fg-3">
            Unconverged findings{' '}
            <span className="font-mono text-amber-300">{payload.unconvergedFindingsCount}</span>
          </div>
        )}
      </div>
    </ReviewEventShell>
  );
}

export function ReviewSlotCompletedEvent({ event }: { event: AgentEventDto }) {
  const payload = event.payload as ReviewWavePayload | null;
  const verdict = payload?.verdict ?? 'unknown';
  const confidencePct =
    typeof payload?.confidence === 'number' ? `${Math.round(payload.confidence * 100)}%` : null;
  const checksCount = Array.isArray(payload?.criteriaChecks) ? payload.criteriaChecks.length : 0;
  const findingsCount =
    typeof payload?.findingsCount === 'number' ? payload.findingsCount : undefined;
  const slotNumber = typeof payload?.slotIndex === 'number' ? payload.slotIndex + 1 : null;
  const isApproved = verdict === 'approved';
  const isNeedsHuman = verdict === 'needs-human';

  return (
    <ReviewEventShell
      event={event}
      icon={
        isApproved ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : (
          <AlertTriangle
            size={13}
            className={`shrink-0 ${isNeedsHuman ? 'text-[color:var(--danger)]' : 'text-amber-400'}`}
          />
        )
      }
      title={slotNumber == null ? 'Review slot completed' : `Review slot ${slotNumber} completed`}
      tone={isApproved ? 'success' : isNeedsHuman ? 'danger' : 'warning'}
      round={payload?.round}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-3">
        <MetricRow
          label="Verdict"
          value={verdict}
          tone={isNeedsHuman ? 'danger' : isApproved ? 'normal' : 'warning'}
        />
        {confidencePct != null && <MetricRow label="Confidence" value={confidencePct} />}
        {findingsCount != null && (
          <MetricRow
            label="Findings"
            value={findingsCount}
            tone={findingsCount > 0 ? 'warning' : 'normal'}
          />
        )}
        <MetricRow label="Criteria checks" value={checksCount} />
        {payload?.slotModel != null && <MetricRow label="Model" value={payload.slotModel} />}
        {payload?.promptVariant != null && (
          <MetricRow label="Prompt" value={payload.promptVariant} />
        )}
      </div>
    </ReviewEventShell>
  );
}
