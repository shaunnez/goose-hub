import { fetchCostSummary } from '@/lib/api';
import type { CostSummaryDto } from '@/lib/types';
import { formatCost } from '@/lib/utils';
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
      <div className="text-[11px] uppercase tracking-wider text-fg-4 mb-1.5">{label}</div>
      <div className="text-[20px] font-semibold tracking-tight">{value}</div>
      {sub != null && <div className="text-[11.5px] text-fg-3 mt-1">{sub}</div>}
    </div>
  );
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
          <div className="flex gap-3 mb-8">
            <StatTile
              testId="cost-week"
              label="This week"
              value={formatCost(
                data.windows.week.totalUsd,
                data.windows.week.hasEstimated ? 'estimated' : 'exact',
              )}
              sub={`${data.windows.week.totalRuns} runs`}
            />
            <StatTile
              testId="cost-month"
              label="This month"
              value={formatCost(
                data.windows.month.totalUsd,
                data.windows.month.hasEstimated ? 'estimated' : 'exact',
              )}
              sub={`${data.windows.month.totalRuns} runs`}
            />
          </div>

          <section data-testid="stage-breakdown" className="border border-line rounded-lg p-5">
            <h2 className="text-[11px] uppercase tracking-wider text-fg-4 mb-4">
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
