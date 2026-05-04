import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Clock, Plus, RefreshCw, XCircle } from 'lucide-react';
import { TIERS, formatWallTime } from '../lib/qa';
import type { QaPayload } from '../lib/qa';
import { QaFindingRow } from './QaFindingRow';
import { QaTestSuiteRow } from './QaTestSuiteRow';
import { QaTierRow } from './QaTierRow';
import { StatCard } from './StatCard';

interface QASectionProps {
  projectSlug: string;
  id: string;
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
        {qa.testRun ? (
          <StatCard
            label="Pass / Fail"
            value={`${qa.testRun.passed} / ${qa.testRun.failed}`}
            sub={
              qa.testRun.skipped > 0
                ? `${qa.testRun.total} total · ${qa.testRun.skipped} skipped`
                : `${qa.testRun.total} total`
            }
            color={qa.testRun.failed === 0 ? 'var(--success)' : 'var(--danger)'}
          />
        ) : (
          <StatCard
            label="Pass / Fail"
            value={`${passedTiers} / ${failedTiers}`}
            sub={`${allFindings.length} findings`}
            color={failedTiers === 0 ? 'var(--success)' : 'var(--danger)'}
          />
        )}
        <StatCard
          label="Score"
          value={`${qa.overallScore}%`}
          sub={`threshold ${threshold}`}
          color={qa.overallScore >= threshold ? 'var(--success)' : 'var(--danger)'}
        />
        {qa.testRun ? (
          <StatCard
            label="Wall time"
            value={formatWallTime(qa.testRun.wallTimeMs)}
            sub={`${qa.testRun.suites.length} ${qa.testRun.suites.length === 1 ? 'suite' : 'suites'}`}
          />
        ) : (
          <StatCard label="Wall time" value="—" sub="not tracked" />
        )}
        <StatCard
          label="Flake risk"
          value={flakeRisk}
          sub={`${errorCount} errors · ${warnCount} warnings`}
          color={flakeColor}
        />
      </div>

      {/* Test suites — when real test-run data is present */}
      {qa.testRun && qa.testRun.suites.length > 0 && (
        <div data-testid="qa-test-suites">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-4">Test suites</div>
            <div className="text-[11px] text-fg-4 mono tnum">
              {qa.testRun.passed} passed · {qa.testRun.failed} failed · {qa.testRun.skipped} skipped
            </div>
          </div>
          <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
            {qa.testRun.suites.map((s, i) => (
              <QaTestSuiteRow key={s.filePath || s.name} suite={s} isFirst={i === 0} />
            ))}
          </div>
        </div>
      )}

      {/* Verification tiers */}
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-2">
          Verification Tiers
        </div>
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          {TIERS.map((tier, i) => (
            <QaTierRow key={tier} tier={tier} result={qa.tierResults?.[tier]} isFirst={i === 0} />
          ))}
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
                <QaFindingRow key={`${tier}:${idx}:${f.description}`} finding={f} tier={tier} />
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
