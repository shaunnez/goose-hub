import type { ProjectConfigDto } from '@/lib/types';
import { MilestonesPanel } from './MilestonesPanel';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-line last:border-0">
      <span className="w-40 shrink-0 text-[11.5px] text-fg-2 uppercase tracking-wider pt-0.5">
        {label}
      </span>
      <span className="text-[12.5px] text-fg font-mono break-all">{value}</span>
    </div>
  );
}

interface Props {
  config: ProjectConfigDto;
}

export function ProjectConfigPanel({ config }: Props) {
  return (
    <div data-testid="project-config-panel" className="flex flex-col gap-0">
      <Row label="Slug" value={config.slug} />
      <Row label="Source" value={`${config.source.kind}:${config.source.repo}`} />
      <Row
        label="Active Milestone"
        value={
          config.activeMilestone != null ? (
            config.activeMilestone
          ) : (
            <span className="text-fg-2 italic">github default</span>
          )
        }
      />
      <Row label="Mode" value={config.mode} />
      <Row
        label="Color"
        value={
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: config.colorStripe }}
            />
            {config.colorStripe}
          </span>
        }
      />
      <Row label="Per-workflow $" value={`$${config.budgets.perWorkflowMaxUsd}`} />
      <Row label="Daily tokens" value={config.budgets.dailyTokens.toLocaleString()} />
      <Row label="Per-advisor $" value={`$${config.budgets.perAdvisorMaxUsd}`} />

      <div className="mt-6 border-t border-line pt-6">
        <MilestonesPanel slug={config.slug} />
      </div>
    </div>
  );
}
