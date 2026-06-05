import { cn } from '@/lib/cn';
import type { AgentEventDto } from '@/lib/types';
import { AlertTriangle, CheckCircle, Circle, LoaderCircle, XCircle } from 'lucide-react';

type TierResult = {
  passed: boolean;
  findings?: { severity: string; description: string }[];
  command?: string | null;
};

type TierPayload = {
  tier?: string | number;
  tierNumber?: number;
  evidence?: string[];
  findingCount?: number;
  findings?: { tier?: string; severity?: string; description?: string }[];
  failureCategory?: string;
  runId?: string;
};

type VerificationStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'unknown'
  | 'posted'
  | 'absent';

type VerificationSummaryPayload = {
  changedFileCount?: number;
  diffCharCount?: number;
  contextByteSizeEstimate?: number;
  lintStatus?: VerificationStatus;
  typecheckStatus?: VerificationStatus;
  testStatus?: VerificationStatus;
  e2eStatus?: VerificationStatus;
  evidenceStatus?: VerificationStatus;
  evidenceReason?: string;
};

type QaPreflightPayload = {
  runId?: string;
  step?: 'lint' | 'typecheck' | 'test' | 'e2e' | 'evidence' | 'executable-checks';
  command?: string;
  status?: 'running' | 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  exitCode?: number;
  reason?: string;
};

type QaWorkflowPayload = {
  status?: 'running' | 'completed' | 'failed' | 'aborted';
  reason?: string;
  nextState?: string;
  verdict?: string;
  error?: string;
};

function tierKeyFromKind(kind: string): string {
  return kind.replace('qa.', '').replace('-failed', '').replace('-passed', '');
}

function formatTierLabel(tier: string | number | undefined, kind: string): string {
  const key = tier ?? tierKeyFromKind(kind);
  const normalized =
    key === 1 || key === '1'
      ? 'structural'
      : key === 2 || key === '2'
        ? 'functional'
        : key === 3 || key === '3'
          ? 'regression'
          : String(key);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function TierEvidence({ evidence, findingCount }: { evidence: string[]; findingCount?: number }) {
  if (evidence.length === 0 && findingCount == null) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 text-[11.5px] text-fg-3">
      {findingCount != null && (
        <div>
          {findingCount} finding{findingCount === 1 ? '' : 's'}
        </div>
      )}
      {evidence.slice(0, 3).map((item) => (
        <div key={item} className="font-mono text-[11px] text-fg-3 break-words">
          {item}
        </div>
      ))}
      {evidence.length > 3 && <div>{evidence.length - 3} more evidence item(s)</div>}
    </div>
  );
}

function formatCount(value: number | undefined, singular: string, plural: string): string {
  const count = value ?? 0;
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function formatCompactChars(value: number | undefined): string {
  const count = value ?? 0;
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}

function formatBytes(value: number | undefined): string {
  const bytes = value ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusTone(status: VerificationStatus | undefined): string {
  if (status === 'running') return 'border-blue-500/20 bg-blue-500/10 text-blue-300';
  if (status === 'passed' || status === 'posted') {
    return 'border-green-500/20 bg-green-500/10 text-green-400';
  }
  if (status === 'failed') return 'border-red-500/20 bg-red-500/10 text-[color:var(--danger)]';
  if (status === 'skipped' || status === 'absent') return 'border-fg-5/20 bg-fg-5/10 text-fg-3';
  return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400';
}

function formatDurationMs(value: number | undefined): string | null {
  if (value == null) return null;
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function qaPreflightStepLabel(step: QaPreflightPayload['step']): string {
  switch (step) {
    case 'lint':
      return 'Lint';
    case 'typecheck':
      return 'Typecheck';
    case 'test':
      return 'Tests';
    case 'e2e':
      return 'E2E';
    case 'evidence':
      return 'Evidence';
    case 'executable-checks':
      return 'Executable checks';
    default:
      return 'Preflight step';
  }
}

function formatFailureCategory(category: string | undefined): string | null {
  if (category == null || category.length === 0) return null;
  return category
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function FailureCategoryBadge({ category }: { category?: string }) {
  const label = formatFailureCategory(category);
  if (label == null) return null;
  return (
    <span className="rounded border border-yellow-500/20 bg-yellow-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-yellow-400">
      {label}
    </span>
  );
}

function StatusRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: VerificationStatus | undefined;
  detail?: string;
}) {
  const normalized = status ?? 'unknown';
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded border border-line bg-bg/40 px-2.5 py-2">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-[11px] text-fg-3">{label}</span>
        {detail != null && detail.length > 0 && (
          <span className="text-[11px] leading-snug text-fg-4">{detail}</span>
        )}
      </span>
      <span
        className={cn(
          'mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
          statusTone(normalized),
        )}
      >
        {normalized}
      </span>
    </div>
  );
}

export function QaPreflightEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as QaPreflightPayload | null;
  const completed = event.kind === 'qa.preflight-completed';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
        {completed ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : (
          <LoaderCircle size={13} className="shrink-0 animate-spin text-blue-300" />
        )}
        <span className="font-mono uppercase tracking-wider">
          {completed ? 'QA preflight completed' : 'QA preflight started'}
        </span>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
            statusTone(p?.status ?? (completed ? 'passed' : 'running')),
          )}
        >
          {p?.status ?? (completed ? 'passed' : 'running')}
        </span>
        <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function QaWorkflowEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as QaWorkflowPayload | null;
  const failed = event.kind === 'qa.workflow-failed';
  const aborted = event.kind === 'qa.workflow-aborted';
  const completed = event.kind === 'qa.workflow-completed';
  const running = event.kind === 'qa.workflow-started';
  const title = running
    ? 'QA workflow started'
    : completed
      ? 'QA workflow completed'
      : aborted
        ? 'QA workflow aborted'
        : 'QA workflow failed';
  const status =
    p?.status ?? (running ? 'running' : completed ? 'completed' : failed ? 'failed' : 'aborted');
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
        {running ? (
          <LoaderCircle size={13} className="shrink-0 animate-spin text-blue-300" />
        ) : failed ? (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        ) : aborted ? (
          <AlertTriangle size={13} className="shrink-0 text-yellow-400" />
        ) : (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        )}
        <span className="font-mono uppercase tracking-wider">{title}</span>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
            statusTone(
              status === 'completed' ? 'passed' : status === 'aborted' ? 'skipped' : status,
            ),
          )}
        >
          {status}
        </span>
        <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {(p?.reason != null || p?.nextState != null || p?.verdict != null || p?.error != null) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-fg-3">
          {p.reason != null && <span>Reason: {p.reason}</span>}
          {p.verdict != null && <span>Verdict: {p.verdict}</span>}
          {p.nextState != null && <span>Next: {p.nextState}</span>}
          {p.error != null && <span className="break-words">Error: {p.error}</span>}
        </div>
      )}
    </li>
  );
}

export function QaPreflightStepEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as QaPreflightPayload | null;
  const status = p?.status ?? (event.kind === 'qa.preflight-step-started' ? 'running' : 'unknown');
  const duration = formatDurationMs(p?.durationMs);
  const failed = status === 'failed';
  const running = status === 'running';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
        {running ? (
          <LoaderCircle size={13} className="shrink-0 animate-spin text-blue-300" />
        ) : failed ? (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        ) : (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        )}
        <span className="font-mono uppercase tracking-wider">{qaPreflightStepLabel(p?.step)}</span>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
            statusTone(status),
          )}
        >
          {status}
        </span>
        {duration != null && <span className="font-mono tnum text-fg-4">{duration}</span>}
        {p?.exitCode != null && <span className="font-mono text-fg-4">exit {p.exitCode}</span>}
      </div>
      {p?.command != null && (
        <div className="truncate font-mono text-[11px] text-fg-3">{p.command}</div>
      )}
      {p?.reason != null && (
        <div className="mt-1 text-[11.5px] leading-snug text-fg-3">{p.reason}</div>
      )}
    </li>
  );
}

export function QaPassedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as TierPayload | null;
  const tierLabel = formatTierLabel(p?.tier, event.kind);
  const evidence = p?.evidence ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-success bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">QA {tierLabel} passed</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <TierEvidence evidence={evidence} findingCount={p?.findingCount} />
    </li>
  );
}

export function QaFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as TierPayload | null;
  const tierLabel = formatTierLabel(p?.tier, event.kind);
  const findings = p?.findings ?? [];
  const evidence = p?.evidence ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        <span className="font-mono uppercase tracking-wider">QA {tierLabel} failed</span>
        <FailureCategoryBadge category={p?.failureCategory} />
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {findings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {findings.map((f, i) => (
            <li
              key={`${f.severity}-${f.description}-${i}`}
              className="flex items-start gap-2 text-[11.5px]"
            >
              <span
                className={cn(
                  'mt-0.5 shrink-0 font-mono text-[10px] px-1 py-0.5 rounded',
                  f.severity === 'error'
                    ? 'bg-red-500/10 text-[color:var(--danger)]'
                    : f.severity === 'warning'
                      ? 'bg-yellow-500/10 text-yellow-400'
                      : 'bg-fg-5/10 text-fg-3',
                )}
              >
                {f.severity ?? 'info'}
              </span>
              <span className="text-fg-2 leading-relaxed">{f.description}</span>
            </li>
          ))}
        </ul>
      )}
      {findings.length === 0 && <TierEvidence evidence={evidence} findingCount={p?.findingCount} />}
    </li>
  );
}

export function QaVerificationSummaryBuiltEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as VerificationSummaryPayload | null;
  const rows: Array<{ label: string; status: VerificationStatus | undefined; detail?: string }> = [
    { label: 'Lint', status: p?.lintStatus },
    { label: 'Typecheck', status: p?.typecheckStatus },
    { label: 'Tests', status: p?.testStatus },
    { label: 'E2E', status: p?.e2eStatus },
    { label: 'Evidence', status: p?.evidenceStatus, detail: p?.evidenceReason },
  ];

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
        <Circle size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">QA verification summary built</span>
        <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-[11.5px] text-fg-3">
        <span>{formatCount(p?.changedFileCount, 'file changed', 'files changed')}</span>
        <span aria-hidden className="text-fg-5">
          /
        </span>
        <span>{formatCompactChars(p?.diffCharCount)} diff chars</span>
        <span aria-hidden className="text-fg-5">
          /
        </span>
        <span>{formatBytes(p?.contextByteSizeEstimate)} context</span>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <StatusRow key={row.label} label={row.label} status={row.status} detail={row.detail} />
        ))}
      </div>
    </li>
  );
}

export function QaCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    agentSkipped?: boolean;
    deterministic?: boolean;
    verdict?: string;
    overallScore?: number;
    threshold?: number;
    failureCategory?: string;
    tierResults?: {
      structural?: TierResult;
      functional?: TierResult;
      regression?: TierResult;
    };
  } | null;

  const verdict = p?.verdict ?? 'unknown';
  const score = p?.overallScore;
  const threshold = p?.threshold ?? 70;
  const tiers = p?.tierResults;

  const verdictColor =
    verdict === 'pass'
      ? 'text-green-400 border-green-500/20 bg-green-500/10'
      : verdict === 'fail'
        ? 'text-[color:var(--danger)] border-red-500/20 bg-red-500/10'
        : 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10';

  const tierRows: { key: 'structural' | 'functional' | 'regression'; label: string }[] = [
    { key: 'structural', label: 'Structural' },
    { key: 'functional', label: 'Functional' },
    { key: 'regression', label: 'Regression suite' },
  ];

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">QA completed</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
            verdictColor,
          )}
        >
          {verdict.toUpperCase()}
        </span>
        {p?.agentSkipped === true && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border border-fg-5/20 bg-fg-5/10 text-fg-3">
            Agent skipped
          </span>
        )}
        <FailureCategoryBadge category={p?.failureCategory} />
        {score != null && (
          <span className="text-[11.5px] text-fg-3 font-mono">
            <span className={score >= threshold ? 'text-green-400' : 'text-[color:var(--danger)]'}>
              {score}
            </span>
            <span className="text-fg-2">/{threshold}</span>
          </span>
        )}
      </div>
      {tiers != null && (
        <div className="flex flex-col gap-1">
          {tierRows.map(({ key, label }) => {
            const tier = tiers[key];
            const skipped = tier == null || (tier.command == null && key === 'regression');
            const passed = tier?.passed ?? false;
            return (
              <div key={key} className="flex items-center gap-2 text-[11px]">
                {skipped ? (
                  <Circle size={11} className="shrink-0 text-fg-2" />
                ) : passed ? (
                  <CheckCircle size={11} className="shrink-0 text-green-400" />
                ) : (
                  <XCircle size={11} className="shrink-0 text-[color:var(--danger)]" />
                )}
                <span className="text-fg-3 font-mono">{label}</span>
                {skipped && <span className="text-fg-5 italic">skipped</span>}
                {!skipped && tier?.command != null && (
                  <span className="text-fg-5 truncate max-w-[260px]">{tier.command}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}

export function QaVerificationBlockedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    failedTier?: number;
    findings?: string[];
    reason?: string;
    agentSkipped?: boolean;
    failureCategory?: string;
  } | null;
  const findings = p?.findings ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-yellow-500/20 bg-yellow-500/5 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-yellow-400" />
        <span className="font-mono uppercase tracking-wider">QA verification blocked</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        {p?.failedTier != null && (
          <span className="rounded border border-yellow-500/20 bg-yellow-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-yellow-400">
            Tier {p.failedTier}
          </span>
        )}
        {p?.reason != null && (
          <span className="rounded border border-line bg-bg/40 px-1.5 py-0.5 font-mono text-[10px] text-fg-3">
            {p.reason}
          </span>
        )}
        {p?.agentSkipped === true && (
          <span className="rounded border border-fg-5/20 bg-fg-5/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-3">
            Agent skipped
          </span>
        )}
        <FailureCategoryBadge category={p?.failureCategory} />
      </div>
      {findings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {findings.slice(0, 3).map((finding) => (
            <li key={finding} className="text-[11.5px] leading-relaxed text-fg-2">
              {finding}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
