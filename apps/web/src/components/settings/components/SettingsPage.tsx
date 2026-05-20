import { BootstrapWizard } from '@/components/bootstrap/components/BootstrapWizard';
import { fetchProjectConfigs } from '@/lib/api';
import type { ProjectConfigDto } from '@/lib/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { DevReviewPanel } from './DevReviewPanel';
import { LearningLoopPanel } from './LearningLoopPanel';
import { MilestonesPanel } from './MilestonesPanel';
import { PipelinePanel } from './PipelinePanel';
import { ProjectBudgetPanel } from './ProjectBudgetPanel';
import { ProjectConfigPanel } from './ProjectConfigPanel';
import { ReviewPanel } from './ReviewPanel';
import { WorkflowMapPanel } from './WorkflowMapPanel';

type Tab =
  | 'summary'
  | 'runtime'
  | 'milestones'
  | 'workflow-map'
  | 'learning-loop'
  | 'pipeline'
  | 'review'
  | 'dev-review';

const TAB_LABELS: Record<Tab, string> = {
  summary: 'Summary',
  runtime: 'Skill runtime',
  milestones: 'Milestones',
  'workflow-map': 'Workflow map',
  'learning-loop': 'Learning loop',
  pipeline: 'Pipeline',
  review: 'Review',
  'dev-review': 'Dev-review',
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [wizardOpen, setWizardOpen] = useState(false);

  const {
    data: configs = [],
    isLoading,
    error,
  } = useQuery<ProjectConfigDto[]>({
    queryKey: ['project-configs'],
    queryFn: ({ signal }) => fetchProjectConfigs(signal),
  });

  const selectedConfig = configs.find((c) => c.slug === selected) ?? configs[0] ?? null;

  function reload() {
    void queryClient.invalidateQueries({ queryKey: ['project-configs'] });
  }

  return (
    <div data-testid="settings-page" className="flex h-full overflow-hidden">
      {/* Left: project list */}
      <div className="w-56 shrink-0 border-r border-line overflow-y-auto py-4 px-2">
        <div className="flex items-center justify-between px-2 mb-3">
          <h2 className="text-[11px] uppercase tracking-wider text-fg-2">Projects</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="add-project-button"
              title="Add project"
              onClick={() => setWizardOpen(true)}
              className="text-fg-2 hover:text-fg transition-colors p-1 rounded"
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              title="Reload configs"
              onClick={reload}
              className="text-fg-2 hover:text-fg transition-colors p-1 rounded"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {isLoading && <div className="text-[12px] text-fg-3 px-2">Loading…</div>}
        {error && <div className="text-[12px] text-danger px-2">Failed to load configs.</div>}

        {configs.map((cfg) => (
          <button
            key={cfg.slug}
            type="button"
            data-testid="project-config-item"
            onClick={() => setSelected(cfg.slug)}
            className={[
              'w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors',
              selected === cfg.slug || (selected === null && cfg === configs[0])
                ? 'bg-accent-soft text-fg'
                : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
            ].join(' ')}
          >
            <span
              className="inline-block w-1.5 h-4 rounded-sm shrink-0"
              style={{ background: cfg.colorStripe }}
            />
            <span className="truncate">{cfg.name}</span>
          </button>
        ))}
      </div>

      {/* Right: project detail */}
      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-8 py-6">
        <h1 className="text-[15px] font-semibold mb-1">Settings</h1>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 mb-6 border-b border-line">
          {(
            [
              'summary',
              'runtime',
              'milestones',
              'workflow-map',
              'learning-loop',
              'pipeline',
              'review',
              'dev-review',
            ] as Tab[]
          ).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                'px-3 py-1.5 text-[12px] capitalize -mb-px border-b-2 transition-colors',
                tab === t
                  ? 'border-accent text-fg font-medium'
                  : 'border-transparent text-fg-2 hover:text-fg',
              ].join(' ')}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === 'summary' && selectedConfig != null && (
          <ProjectConfigPanel config={selectedConfig} />
        )}
        {tab === 'runtime' && selectedConfig != null && (
          <ProjectBudgetPanel slug={selectedConfig.slug} />
        )}
        {tab === 'milestones' && selectedConfig != null && (
          <MilestonesPanel slug={selectedConfig.slug} />
        )}
        {tab === 'workflow-map' && selectedConfig != null && (
          <WorkflowMapPanel slug={selectedConfig.slug} />
        )}
        {tab === 'learning-loop' && selectedConfig != null && (
          <LearningLoopPanel slug={selectedConfig.slug} />
        )}
        {tab === 'pipeline' && selectedConfig != null && (
          <PipelinePanel slug={selectedConfig.slug} />
        )}
        {tab === 'review' && selectedConfig != null && <ReviewPanel slug={selectedConfig.slug} />}
        {tab === 'dev-review' && selectedConfig != null && (
          <DevReviewPanel slug={selectedConfig.slug} />
        )}

        {!isLoading && !error && configs.length === 0 && (
          <div className="text-[13px] text-fg-3 py-16 text-center">
            No projects registered. Add a{' '}
            <code className="font-mono">target-projects/&lt;slug&gt;/project.config.ts</code>.
          </div>
        )}
      </div>

      <BootstrapWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
