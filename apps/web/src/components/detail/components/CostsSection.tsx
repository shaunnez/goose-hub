import { CostLegend } from '@/components/costs/CostLegend';
import { fetchIssueCosts } from '@/lib/api';
import type { CostRowDto, WorkItemCostsDto } from '@/lib/types';
import { formatCost, formatTokens, timeAgo } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { SectionEmptyState } from './SectionEmptyState';

interface CostsSectionProps {
  projectSlug: string;
  id: string;
}

const STAGE_LABEL: Record<CostRowDto['stage'], string> = {
  triage: 'Triage',
  investigate: 'Investigate',
  dev: 'Dev',
  qa: 'QA',
  review: 'Review',
  retrospective: 'Retrospective',
  other: 'Other',
};

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex-1 border border-line rounded-lg p-3 bg-bg-elev/60">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1">{label}</div>
      <div className="text-[18px] font-semibold tracking-tight">{value}</div>
      {sub != null && <div className="text-[11px] text-fg-3 mt-0.5">{sub}</div>}
    </div>
  );
}

export function CostsSection({ projectSlug, id }: CostsSectionProps) {
  const { data, isLoading, error } = useQuery<WorkItemCostsDto>({
    queryKey: ['issue-costs', projectSlug, id],
    queryFn: () => fetchIssueCosts(projectSlug, id),
  });

  if (isLoading) return null;

  if (error) {
    return (
      <div className="px-8 py-6 text-[13px] text-[color:var(--danger)]">Failed to load costs.</div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="px-8 py-6">
        <SectionEmptyState
          data-testid="costs-empty-state"
          icon={Coins}
          title="No agent runs recorded for this task yet."
          subtitle="Cost rows are written as runs complete."
        />
      </div>
    );
  }

  const totalLabel = data.hasEstimated ? 'estimated' : 'exact';
  const totalTokens = data.rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

  return (
    <div data-testid="costs-section" className="px-8 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider">
          Token economics for this task
        </h2>
        {data.hasEstimated && <CostLegend />}
      </div>

      <div className="flex gap-3">
        <StatTile
          label="Spent"
          value={formatCost(data.totalUsd, totalLabel)}
          sub={`${data.rows.length} run${data.rows.length === 1 ? '' : 's'}`}
        />
        <StatTile label="Tokens" value={formatTokens(totalTokens)} sub="across all runs" />
      </div>

      <div className="border border-line rounded-lg overflow-hidden">
        <div className="grid grid-cols-[120px_120px_140px_1fr_100px] px-4 py-2.5 border-b border-line bg-bg-elev/50 text-[10.5px] uppercase tracking-wider text-fg-4">
          <span>Stage</span>
          <span>Skill</span>
          <span>Model</span>
          <span className="text-right">Tokens</span>
          <span className="text-right">Cost</span>
        </div>
        {data.rows.map((r) => (
          <div
            key={r.runId}
            data-testid={`costs-row-${r.runId}`}
            className="grid grid-cols-[120px_120px_140px_1fr_100px] px-4 py-2.5 border-t border-line items-center text-[12px]"
          >
            <span className="text-fg-2">{STAGE_LABEL[r.stage]}</span>
            <span className="font-mono text-fg-3 text-[11.5px]">{r.skill}</span>
            <span className="font-mono text-fg-3 text-[11.5px]">{r.modelId}</span>
            <span className="text-right font-mono text-fg-2">
              {formatTokens(r.inputTokens + r.outputTokens)}
            </span>
            <span className="text-right font-mono text-fg-2">
              {formatCost(r.costUsd, r.costLabel)}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-fg-4">
        Most recent run: {timeAgo(data.rows[data.rows.length - 1].createdAt)}
      </p>
    </div>
  );
}
