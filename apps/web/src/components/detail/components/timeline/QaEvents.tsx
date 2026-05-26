import { cn } from '@/lib/cn';
import type { AgentEventDto } from '@/lib/types';
import { AlertTriangle, CheckCircle, Circle, XCircle } from 'lucide-react';

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

type VerificationStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

type VerificationSummaryPayload = {
  changedFileCount?: number;
  diffCharCount?: number;
  contextByteSizeEstimate?: number;
  lintStatus?: VerificationStatus;
  typecheckStatus?: VerificationStatus;
  testStatus?: VerificationStatus;
  e2eStatus?: VerificationStatus;
  evidenceStatus?: VerificationStatus;
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
  if (status === 'passed') return 'border-green-500/20 bg-green-500/10 text-green-400';
  if (status === 'failed') return 'border-red-500/20 bg-red-500/10 text-[color:var(--danger)]';
  if (status === 'skipped') return 'border-fg-5/20 bg-fg-5/10 text-fg-3';
  return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400';
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
}: {
  label: string;
  status: VerificationStatus | undefined;
}) {
  const normalized = status ?? 'unknown';
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded border border-line bg-bg/40 px-2.5 py-2">
      <span className="min-w-0 truncate font-mono text-[11px] text-fg-3">{label}</span>
      <span
        className={cn(
          'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
          statusTone(normalized),
        )}
      >
        {normalized}
      </span>
    </div>
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
  const rows: Array<{ label: string; status: VerificationStatus | undefined }> = [
    { label: 'Lint', status: p?.lintStatus },
    { label: 'Typecheck', status: p?.typecheckStatus },
    { label: 'Tests', status: p?.testStatus },
    { label: 'E2E', status: p?.e2eStatus },
    { label: 'Evidence', status: p?.evidenceStatus },
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
          <StatusRow key={row.label} label={row.label} status={row.status} />
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
    { key: 'regression', label: 'Regression (playwright)' },
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
