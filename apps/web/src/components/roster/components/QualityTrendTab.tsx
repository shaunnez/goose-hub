import { fetchQualityTrend } from '@/lib/api';
import type { QualityTrendPointDto } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--success, #22c55e)';
  if (score >= 60) return 'var(--warning, #f59e0b)';
  return 'var(--danger, #ef4444)';
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: scoreColor(score) }}
        />
      </div>
      <span
        className="text-[11px] font-mono w-8 text-right shrink-0"
        style={{ color: scoreColor(score) }}
      >
        {score}
      </span>
    </div>
  );
}

function ComponentsBadges({ point }: { point: QualityTrendPointDto }) {
  const c = point.components;
  const findings = c.p0_count + c.p1_count + c.p2_count + c.p3_count;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {c.p0_count > 0 && (
        <span className="px-1 py-0.5 rounded text-[10px] font-mono bg-[color:var(--danger)] text-white">
          P0×{c.p0_count}
        </span>
      )}
      {c.p1_count > 0 && (
        <span className="px-1 py-0.5 rounded text-[10px] font-mono bg-[color:var(--danger)]/20 text-[color:var(--danger)]">
          P1×{c.p1_count}
        </span>
      )}
      {findings === 0 && (
        <span className="px-1 py-0.5 rounded text-[10px] font-mono bg-[color:var(--success)]/20 text-[color:var(--success)]">
          no findings
        </span>
      )}
      {c.regressions_open > 0 && (
        <span className="px-1 py-0.5 rounded text-[10px] font-mono bg-[color:var(--warning)]/20 text-[color:var(--warning)]">
          reg×{c.regressions_open}
        </span>
      )}
      {!c.static_passed && (
        <span className="px-1 py-0.5 rounded text-[10px] font-mono bg-bg-hover text-fg-3">
          tier1 fail
        </span>
      )}
      {!c.uat_passed && (
        <span className="px-1 py-0.5 rounded text-[10px] font-mono bg-bg-hover text-fg-3">
          tier2 fail
        </span>
      )}
    </div>
  );
}

function TrendRow({ point }: { point: QualityTrendPointDto }) {
  return (
    <div className="py-3 border-b border-line last:border-0">
      <div className="flex items-center justify-between gap-4 mb-1.5">
        <span className="text-[11.5px] font-mono text-fg-3 truncate">
          {point.runId.slice(0, 12)}
        </span>
        <span className="text-[11px] text-fg-3 shrink-0">{timeAgo(point.ts)}</span>
      </div>
      <ScoreBar score={point.score} />
      <ComponentsBadges point={point} />
    </div>
  );
}

export function QualityTrendTab({ projectSlug }: { projectSlug: string }) {
  const {
    data: trend = [],
    isLoading,
    error,
  } = useQuery<QualityTrendPointDto[]>({
    queryKey: ['quality-trend', projectSlug],
    queryFn: () => fetchQualityTrend(projectSlug),
    enabled: projectSlug.length > 0,
  });

  if (isLoading) {
    return <div className="px-8 py-6 text-fg-3 text-[13px]">Loading quality trend…</div>;
  }

  if (error) {
    return (
      <div className="px-8 py-6 text-[color:var(--danger)] text-[13px]">
        Failed to load quality trend.
      </div>
    );
  }

  if (trend.length === 0) {
    return (
      <div
        data-testid="quality-trend-empty"
        className="px-8 py-16 text-center text-fg-3 text-[13px]"
      >
        <p className="mb-2 font-medium text-fg-2">No quality scores yet</p>
        <p>Scores accumulate as pipeline runs complete.</p>
      </div>
    );
  }

  const latest = trend[trend.length - 1];
  const avg =
    trend.length > 0 ? Math.round(trend.reduce((sum, p) => sum + p.score, 0) / trend.length) : 0;

  return (
    <div data-testid="quality-trend-tab" className="flex flex-col h-full overflow-hidden">
      {/* Summary header */}
      <div className="px-8 py-4 border-b border-line flex items-center gap-8">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-fg-3 mb-0.5">Latest</div>
          <div
            className="text-[22px] font-bold font-mono"
            style={{ color: scoreColor(latest.score) }}
          >
            {latest.score}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-fg-3 mb-0.5">
            Avg ({trend.length} runs)
          </div>
          <div className="text-[22px] font-bold font-mono" style={{ color: scoreColor(avg) }}>
            {avg}
          </div>
        </div>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto px-8 py-2">
        {[...trend].reverse().map((point) => (
          <TrendRow key={`${point.runId}-${point.iteration}`} point={point} />
        ))}
      </div>
    </div>
  );
}
