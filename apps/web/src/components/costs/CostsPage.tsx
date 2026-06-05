import { fetchCostSummary } from '@/lib/api';
import type { CostSummaryDto } from '@/lib/types';
import { formatCost, formatTokens } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { CostLegend } from './CostLegend';
import { StageBar } from './StageBar';

function StatTile({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex-1 border border-line rounded-lg p-4 bg-bg-elev/60">
      <div className="text-[11px] uppercase tracking-wider text-fg-2 mb-1.5">{label}</div>
      <div className="text-[14px] font-semibold tracking-tight">{value}</div>
      {sub != null && <div className="text-[11.5px] text-fg-3 mt-1">{sub}</div>}
    </div>
  );
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatCacheHitPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}% cache`;
}

export function CostsPage() {
  const { slug = 'goose-hub-self' } = useParams<{ slug: string }>();

  const { data, isLoading, error } = useQuery<CostSummaryDto>({
    queryKey: ['costs-summary', slug],
    queryFn: () => fetchCostSummary(slug),
  });

  return (
    <div data-testid="costs-page" className="h-full overflow-y-auto px-8 py-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[15px] font-semibold flex items-center gap-2">
            <Coins size={15} className="text-accent" />
            Costs
          </h1>
          <p className="text-[12px] text-fg-3 mt-1">
            Per-stage agent spend across the project. Updated as runs complete.
          </p>
        </div>
        {data?.windows && (data.windows.week.hasEstimated || data.windows.month.hasEstimated) && (
          <CostLegend />
        )}
      </header>

      {isLoading && <div className="text-[13px] text-fg-3">Loading costs…</div>}
      {error && (
        <div className="text-[13px] text-[color:var(--danger)]">Failed to load cost summary.</div>
      )}

      {data && (
        <>
          <div className="flex gap-3 mb-6">
            <StatTile
              testId="cost-week"
              label="This week"
              value={formatCost(
                data.windows.week.totalUsd,
                data.windows.week.hasEstimated ? 'estimated' : 'exact',
              )}
              sub={`${data.windows.week.totalRuns} runs · ${formatCacheHitPercent(data.windows.week.cacheHitRatio)} · cc ${formatTokens(data.windows.week.cacheCreationInputTokens)} · r ${formatTokens(data.windows.week.reasoningOutputTokens)}`}
            />
            <StatTile
              testId="cost-month"
              label="This month"
              value={formatCost(
                data.windows.month.totalUsd,
                data.windows.month.hasEstimated ? 'estimated' : 'exact',
              )}
              sub={`${data.windows.month.totalRuns} runs · ${formatCacheHitPercent(data.windows.month.cacheHitRatio)} · cc ${formatTokens(data.windows.month.cacheCreationInputTokens)} · r ${formatTokens(data.windows.month.reasoningOutputTokens)}`}
            />
          </div>

          <section
            data-testid="provider-breakdown"
            className="border border-line rounded-lg p-5 mb-6"
          >
            <h2 className="text-[11px] uppercase tracking-wider text-fg-2 mb-4">
              By provider · last 30 days
            </h2>
            <div className="flex gap-3">
              <StatTile
                testId="cost-provider-claude"
                label="Claude"
                value={formatCost(
                  data.byProvider.claude.totalUsd,
                  data.byProvider.claude.hasEstimated ? 'estimated' : 'exact',
                )}
                sub={`${data.byProvider.claude.totalRuns} run${data.byProvider.claude.totalRuns === 1 ? '' : 's'} · ${formatCacheHitPercent(data.byProvider.claude.cacheHitRatio)} · cc ${formatTokens(data.byProvider.claude.cacheCreationInputTokens)} · r ${formatTokens(data.byProvider.claude.reasoningOutputTokens)}`}
              />
              <StatTile
                testId="cost-provider-codex"
                label="Codex"
                value={formatCost(
                  data.byProvider.codex.totalUsd,
                  data.byProvider.codex.hasEstimated ? 'estimated' : 'exact',
                )}
                sub={`${data.byProvider.codex.totalRuns} run${data.byProvider.codex.totalRuns === 1 ? '' : 's'} · ${formatCacheHitPercent(data.byProvider.codex.cacheHitRatio)} · cc ${formatTokens(data.byProvider.codex.cacheCreationInputTokens)} · r ${formatTokens(data.byProvider.codex.reasoningOutputTokens)}`}
              />
            </div>
          </section>

          <section
            data-testid="symbol-index-measurement"
            className="border border-line rounded-lg p-5 mb-6"
          >
            <h2 className="text-[11px] uppercase tracking-wider text-fg-2 mb-4">
              Symbol index · all time
            </h2>
            <div className="flex gap-3 mb-4">
              <StatTile
                testId="symbol-index-lookups"
                label="Lookups"
                value={data.symbolIndex.lookupCount.toLocaleString()}
                sub={`${data.symbolIndex.hintsUsedEventCount.toLocaleString()} hints-used event${data.symbolIndex.hintsUsedEventCount === 1 ? '' : 's'}`}
              />
              <StatTile
                testId="symbol-index-identifiers"
                label="Avg identifiers"
                value={formatMetric(data.symbolIndex.averageIdentifiersPerLookup)}
                sub={`${formatMetric(data.symbolIndex.averageHintsPerLookup)} hints per lookup`}
              />
              <StatTile
                testId="symbol-index-used"
                label="Used hints"
                value={data.symbolIndex.usedHintCount.toLocaleString()}
                sub={`${Math.round(data.symbolIndex.staleRate * 100)}% stale lookups`}
              />
            </div>
            {Object.keys(data.symbolIndex.hintsByConsumerSkill).length > 0 && (
              <div className="overflow-hidden rounded-md border border-line/70">
                <table className="w-full text-left text-[11.5px]">
                  <thead className="bg-bg/60 text-fg-3">
                    <tr>
                      <th className="px-3 py-2 font-medium">Consumer</th>
                      <th className="px-3 py-2 font-medium text-right">Lookups</th>
                      <th className="px-3 py-2 font-medium text-right">Avg hints</th>
                      <th className="px-3 py-2 font-medium text-right">Total hints</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.symbolIndex.hintsByConsumerSkill).map(
                      ([consumerSkill, row]) => (
                        <tr key={consumerSkill} className="border-t border-line/60">
                          <td className="px-3 py-2 font-mono text-fg-2">{consumerSkill}</td>
                          <td className="px-3 py-2 text-right tnum">
                            {row.lookupCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tnum">
                            {formatMetric(row.averageHints)}
                          </td>
                          <td className="px-3 py-2 text-right tnum">
                            {row.totalHints.toLocaleString()}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section data-testid="stage-breakdown" className="border border-line rounded-lg p-5">
            <h2 className="text-[11px] uppercase tracking-wider text-fg-2 mb-4">
              Per-stage breakdown · last 30 days
            </h2>
            {data.byStage.length === 0 ? (
              <div
                data-testid="costs-empty-state"
                className="text-center text-[13px] text-fg-3 py-8"
              >
                <p className="mb-1 font-medium text-fg-2">No agent runs yet</p>
                <p>Cost rows are written as runs complete.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {(() => {
                  const max = Math.max(...data.byStage.map((s) => s.totalUsd));
                  return data.byStage.map((s) => (
                    <StageBar
                      key={s.stage}
                      stage={s.stage}
                      totalUsd={s.totalUsd}
                      hasEstimated={s.hasEstimated}
                      totalRuns={s.totalRuns}
                      maxUsd={max}
                      cacheHitRatio={s.cacheHitRatio}
                      cacheCreationInputTokens={s.cacheCreationInputTokens}
                      reasoningOutputTokens={s.reasoningOutputTokens}
                    />
                  ));
                })()}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
