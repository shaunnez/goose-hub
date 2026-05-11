import type { CostStage } from '@/lib/types';
import { formatCost } from '@/lib/utils';

const STAGE_LABEL: Record<CostStage, string> = {
  triage: 'Triage',
  discover: 'Discover',
  investigate: 'Investigate',
  dev: 'Dev',
  qa: 'QA',
  review: 'Review',
  retrospective: 'Retrospective',
  other: 'Other',
};

interface Props {
  stage: CostStage;
  totalUsd: number;
  hasEstimated: boolean;
  totalRuns: number;
  maxUsd: number;
}

export function StageBar({ stage, totalUsd, hasEstimated, totalRuns, maxUsd }: Props) {
  const pct = maxUsd > 0 ? Math.max(2, (totalUsd / maxUsd) * 100) : 0;
  return (
    <div
      data-testid={`stage-bar-${stage}`}
      className="grid grid-cols-[120px_1fr_120px] items-center gap-3"
    >
      <span className="text-[12.5px] text-fg-2">{STAGE_LABEL[stage]}</span>
      <div className="h-2 rounded-full bg-bg overflow-hidden">
        <div
          style={{
            width: `${pct}%`,
            background: 'var(--accent, #7c3aed)',
            height: '100%',
            borderRadius: 9999,
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2 font-mono text-[12px]">
        <span className="text-fg-2">
          {formatCost(totalUsd, hasEstimated ? 'estimated' : 'exact')}
        </span>
        <span className="text-fg-2">·</span>
        <span className="text-fg-2">
          {totalRuns} run{totalRuns === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
