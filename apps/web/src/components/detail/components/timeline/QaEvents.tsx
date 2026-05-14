import { cn } from '@/lib/cn';
import type { AgentEventDto } from '@/lib/types';
import { CheckCircle, Circle, XCircle } from 'lucide-react';

type TierResult = {
  passed: boolean;
  findings?: { severity: string; description: string }[];
  command?: string | null;
};

type TierPayload = {
  tier?: string | number;
  evidence?: string[];
  findingCount?: number;
  findings?: { tier?: string; severity?: string; description?: string }[];
  runId?: string;
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

export function QaCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    verdict?: string;
    overallScore?: number;
    threshold?: number;
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
