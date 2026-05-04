import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Clock, Plus, RefreshCw, XCircle } from 'lucide-react';

interface QASectionProps {
  projectSlug: string;
  id: string;
}

interface Finding {
  tier: 'structural' | 'functional' | 'regression';
  severity: 'error' | 'warning' | 'info';
  file?: string | null;
  line?: number | null;
  description: string;
  suggestion?: string;
}

interface TierResult {
  passed: boolean;
  findings: Finding[];
  command?: string | null;
  output?: string | null;
}

interface QaPayload {
  verdict: 'pass' | 'fail' | 'partial';
  overallScore: number;
  threshold?: number;
  tierResults: {
    structural: TierResult;
    functional: TierResult;
    regression: TierResult;
  };
}

const TIERS = ['structural', 'functional', 'regression'] as const;

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg-elev px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1.5">{label}</div>
      <div
        className="mono tnum text-[22px] font-semibold leading-none tracking-tight"
        style={{ color: color ?? 'var(--fg)' }}
      >
        {value}
      </div>
      {sub && <div className="text-[11.5px] text-fg-3 mt-1.5">{sub}</div>}
    </div>
  );
}

function severityColor(sev: Finding['severity']): string {
  if (sev === 'error') return 'var(--danger)';
  if (sev === 'warning') return 'var(--warning)';
  return 'var(--info)';
}

export function QASection({ projectSlug, id }: QASectionProps) {
  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });

  if (isLoading) return null;

  const qaEvent = [...events].reverse().find((e) => e.kind === 'qa.completed');
  const qa = qaEvent?.payload as QaPayload | undefined;

  if (!qa) {
    return (
      <div data-testid="qa-section" className="px-8 py-6 flex flex-col gap-5">
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1">06 · QA</div>
          <h2 className="text-[17px] font-semibold text-fg leading-snug">Verification sweep</h2>
          <div className="text-[12.5px] text-fg-3 mt-1">
            QA runs automatically after the PR is opened.
          </div>
        </div>
        <div
          data-testid="qa-empty-state"
          className="rounded-lg border border-line bg-bg-elev px-6 py-12 flex flex-col items-center justify-center gap-2 text-center"
        >
          <Clock size={24} className="text-fg-3 opacity-50" />
          <p className="text-[13px] text-fg-3">Waiting for QA to run…</p>
          <p className="text-[12px] text-fg-4">QA runs automatically after the PR is opened.</p>
        </div>
      </div>
    );
  }

  const threshold = qa.threshold ?? 70;
  const allFindings = TIERS.flatMap((t) => qa.tierResults?.[t]?.findings ?? []);
  const errorCount = allFindings.filter((f) => f.severity === 'error').length;
  const warnCount = allFindings.filter((f) => f.severity === 'warning').length;
  const infoCount = allFindings.filter((f) => f.severity === 'info').length;
  const passedTiers = TIERS.filter((t) => qa.tierResults?.[t]?.passed).length;
  const failedTiers = TIERS.length - passedTiers;

  const verdictColor =
    qa.verdict === 'pass'
      ? 'var(--success)'
      : qa.verdict === 'fail'
        ? 'var(--danger)'
        : 'var(--warning)';
  const VerdictIcon =
    qa.verdict === 'pass' ? CheckCircle : qa.verdict === 'fail' ? XCircle : AlertCircle;

  const flakeRisk = errorCount > 0 ? 'high' : warnCount > 0 ? 'medium' : 'low';
  const flakeColor =
    flakeRisk === 'low'
      ? 'var(--success)'
      : flakeRisk === 'medium'
        ? 'var(--warning)'
        : 'var(--danger)';

  return (
    <div data-testid="qa-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1">06 · QA</div>
          <h2 className="text-[17px] font-semibold text-fg leading-snug">Verification sweep</h2>
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3 mt-1">
            <VerdictIcon size={13} style={{ color: verdictColor }} />
            <span style={{ color: verdictColor, textTransform: 'uppercase', fontWeight: 600 }}>
              {qa.verdict}
            </span>
            <span className="text-fg-4">·</span>
            <span>
              {passedTiers} of {TIERS.length} tiers passing
            </span>
            <span className="text-fg-4">·</span>
            <span>
              {allFindings.length} {allFindings.length === 1 ? 'finding' : 'findings'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-bg-elev hover:bg-bg-hover text-[12px] text-fg-2"
          >
            <RefreshCw size={12} /> Re-run
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-accent-line bg-accent-soft hover:opacity-80 text-[12px] text-accent"
          >
            <Plus size={12} /> Add test
          </button>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Pass / Fail"
          value={`${passedTiers} / ${failedTiers}`}
          sub={`${allFindings.length} findings`}
          color={failedTiers === 0 ? 'var(--success)' : 'var(--danger)'}
        />
        <StatCard
          label="Score"
          value={`${qa.overallScore}%`}
          sub={`threshold ${threshold}`}
          color={qa.overallScore >= threshold ? 'var(--success)' : 'var(--danger)'}
        />
        <StatCard label="Wall time" value="—" sub="not tracked" />
        <StatCard
          label="Flake risk"
          value={flakeRisk}
          sub={`${errorCount} errors · ${warnCount} warnings`}
          color={flakeColor}
        />
      </div>

      {/* Verification tiers */}
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-2">
          Verification Tiers
        </div>
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          {TIERS.map((tier, i) => {
            const result = qa.tierResults?.[tier];
            const findings = result?.findings ?? [];
            const passed = !!result?.passed;
            const dots: Array<{ key: string; sev: Finding['severity'] | null }> =
              findings.length > 0
                ? findings.slice(0, 16).map((f, idx) => ({
                    key: `${tier}-f-${idx}-${f.severity}`,
                    sev: f.severity,
                  }))
                : Array.from({ length: 8 }, (_, idx) => ({
                    key: `${tier}-empty-${idx}`,
                    sev: null,
                  }));
            return (
              <div
                key={tier}
                className="grid items-center px-4 py-3"
                style={{
                  gridTemplateColumns: '1.5fr 1fr 90px 90px 90px',
                  borderTop: i ? '1px solid var(--line)' : 'none',
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 8,
                      height: 8,
                      background: passed ? 'var(--success)' : 'var(--danger)',
                    }}
                  />
                  <span className="mono text-[12.5px] capitalize">{tier}</span>
                </div>
                <div className="flex items-center gap-1">
                  {dots.map((d) => (
                    <span
                      key={d.key}
                      style={{
                        width: 8,
                        height: 14,
                        borderRadius: 1.5,
                        background: d.sev === null ? 'var(--success)' : severityColor(d.sev),
                        opacity: d.sev === null ? 0.7 : 1,
                      }}
                    />
                  ))}
                </div>
                <span className="mono tnum text-right text-[12px] text-fg-2">
                  {passed ? 'pass' : `${findings.length} issue${findings.length === 1 ? '' : 's'}`}
                </span>
                <span
                  className="mono tnum text-right text-[12px] text-fg-3 truncate"
                  title={result?.command ?? ''}
                >
                  {result?.command ?? '—'}
                </span>
                <span className="text-right">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10.5px] font-medium uppercase tracking-wide"
                    style={{
                      color: passed ? 'var(--success)' : 'var(--danger)',
                      borderColor: passed
                        ? 'oklch(from var(--success) l c h / 0.4)'
                        : 'oklch(from var(--danger) l c h / 0.4)',
                      background: passed
                        ? 'oklch(from var(--success) l c h / 0.1)'
                        : 'oklch(from var(--danger) l c h / 0.1)',
                    }}
                  >
                    {passed ? 'passing' : 'failing'}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Findings */}
      {allFindings.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-4">Findings</div>
            <div className="text-[11px] text-fg-4 mono tnum">
              {errorCount} error{errorCount === 1 ? '' : 's'} · {warnCount} warning
              {warnCount === 1 ? '' : 's'} · {infoCount} info
            </div>
          </div>
          <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
            {TIERS.flatMap((tier) =>
              (qa.tierResults?.[tier]?.findings ?? []).map((f, idx) => (
                <div
                  key={`${tier}:${idx}:${f.description}`}
                  className="px-4 py-3 border-t border-line first:border-t-0 text-[12.5px]"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
                      style={{
                        color: severityColor(f.severity),
                        background: `oklch(from ${severityColor(f.severity)} l c h / 0.12)`,
                      }}
                    >
                      {f.severity}
                    </span>
                    <span className="text-[11px] text-fg-4 capitalize">{tier}</span>
                    {f.file && (
                      <span className="mono text-[10.5px] text-fg-3 bg-bg-elev-2 px-1.5 py-0.5 rounded">
                        {f.file}
                        {f.line != null ? `:${f.line}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-fg-2">{f.description}</div>
                  {f.suggestion && (
                    <div className="text-[11.5px] text-fg-3 mt-1">→ {f.suggestion}</div>
                  )}
                </div>
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
