import {
  fetchDevReviewSettings,
  fetchPipelineSettings,
  fetchProjectSettings,
  fetchReviewSettings,
  fetchWorkflowCatalog,
} from '@/lib/api';
import type {
  DevReviewSettingsDto,
  PipelineSettingsDto,
  ProjectSettingsDto,
  ReviewSettingsDto,
  WorkflowKind,
} from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Info, ShieldCheck, Split } from 'lucide-react';
import { useMemo, useState } from 'react';
import { KIND_LABELS, WORKFLOW_KINDS, buildEffectiveModes } from '../lib/workflow-map';
import { MapBadge, WorkflowMapFlow } from './WorkflowMapFlow';
import { WorkflowPipelineReviewSettings } from './WorkflowPipelineReviewSettings';
import { WorkflowSkillDetailModal } from './WorkflowSkillDetailModal';

interface WorkflowMapPanelProps {
  slug: string;
}

export function WorkflowMapPanel({ slug }: WorkflowMapPanelProps) {
  const [kind, setKind] = useState<WorkflowKind>('bug');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedStageIds, setExpandedStageIds] = useState<ReadonlySet<string>>(() => new Set());

  const catalogQuery = useQuery({
    queryKey: ['workflow-catalog'],
    queryFn: ({ signal }) => fetchWorkflowCatalog(signal),
  });
  const settingsQuery = useQuery<ProjectSettingsDto>({
    queryKey: ['project-settings', slug],
    queryFn: ({ signal }) => fetchProjectSettings(slug, signal),
  });
  const pipelineQuery = useQuery<PipelineSettingsDto>({
    queryKey: ['pipeline-settings', slug],
    queryFn: ({ signal }) => fetchPipelineSettings(slug, signal),
  });
  const devReviewQuery = useQuery<DevReviewSettingsDto>({
    queryKey: ['dev-review-settings', slug],
    queryFn: ({ signal }) => fetchDevReviewSettings(slug, signal),
  });
  const reviewQuery = useQuery<ReviewSettingsDto>({
    queryKey: ['review-settings', slug],
    queryFn: ({ signal }) => fetchReviewSettings(slug, signal),
  });

  const entry = catalogQuery.data?.catalog.find((candidate) => candidate.kind === kind) ?? null;
  const selectedNode = entry?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const modes = useMemo(
    () =>
      buildEffectiveModes(
        settingsQuery.data,
        pipelineQuery.data,
        devReviewQuery.data,
        reviewQuery.data,
      ),
    [settingsQuery.data, pipelineQuery.data, devReviewQuery.data, reviewQuery.data],
  );

  return (
    <div className="min-w-0 max-w-5xl overflow-x-hidden">
      <WorkflowPipelineReviewSettings modes={modes} />

      <WorkflowKindSelector
        selectedKind={kind}
        onSelectKind={(nextKind) => {
          setKind(nextKind);
          setSelectedNodeId(null);
        }}
      />

      {catalogQuery.isLoading && <p className="text-[12px] text-fg-3">Loading workflow map...</p>}
      {catalogQuery.error && (
        <p className="text-[12px] text-danger">Failed to load workflow map.</p>
      )}

      {entry != null && (
        <div className="space-y-5">
          <WorkflowMapSummary title={entry.title} description={entry.description} />

          {selectedNode != null && (
            <WorkflowSkillDetailModal
              node={selectedNode}
              settings={settingsQuery.data}
              modes={modes}
              onClose={() => setSelectedNodeId(null)}
            />
          )}

          <WorkflowAccordionControls
            onExpandAll={() => {
              setExpandedStageIds((previous) =>
                setKindStageExpansion(
                  previous,
                  kind,
                  entry.stages.map((stage) => stage.id),
                ),
              );
            }}
            onCollapseAll={() => {
              setExpandedStageIds((previous) => setKindStageExpansion(previous, kind, []));
            }}
          />

          <WorkflowMapFlow
            entry={entry}
            modes={modes}
            settings={settingsQuery.data}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            expandedStageIds={expandedStageIds}
            onToggleStage={(stageId) => {
              const stageKey = `${kind}:${stageId}`;
              setExpandedStageIds((previous) => toggleSetValue(previous, stageKey));
            }}
          />
        </div>
      )}
    </div>
  );
}

function WorkflowAccordionControls({
  onExpandAll,
  onCollapseAll,
}: {
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-end gap-3">
      <button
        type="button"
        data-testid="workflow-expand-all"
        onClick={onExpandAll}
        className="font-mono text-[11px] uppercase tracking-wider text-fg-3 transition-colors hover:text-fg"
      >
        Expand all
      </button>
      <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-5" />
      <button
        type="button"
        data-testid="workflow-collapse-all"
        onClick={onCollapseAll}
        className="font-mono text-[11px] uppercase tracking-wider text-fg-3 transition-colors hover:text-fg"
      >
        Collapse all
      </button>
    </div>
  );
}

function WorkflowKindSelector({
  selectedKind,
  onSelectKind,
}: {
  selectedKind: WorkflowKind;
  onSelectKind: (kind: WorkflowKind) => void;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-fg-2">
        Workflow map
      </h3>
      <div className="flex w-full flex-wrap gap-1 rounded-md border border-line bg-bg-subtle p-1">
        {WORKFLOW_KINDS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => onSelectKind(candidate)}
            className={[
              'min-w-20 flex-1 rounded px-3 py-1.5 text-[12px] transition-colors',
              selectedKind === candidate
                ? 'bg-accent-soft font-medium text-fg'
                : 'text-fg-2 hover:bg-bg-hover hover:text-fg',
            ].join(' ')}
          >
            {KIND_LABELS[candidate]}
          </button>
        ))}
      </div>
    </section>
  );
}

function WorkflowMapSummary({ title, description }: { title: string; description: string }) {
  return (
    <section>
      <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[14px] font-semibold text-fg">{title}</h4>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-fg-2">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <MapBadge icon={<ShieldCheck size={12} />} label="holdout boundary" />
          <MapBadge icon={<Split size={12} />} label="fan-out/fan-in" />
          <MapBadge icon={<Info size={12} />} label="effective path" />
        </div>
      </div>
    </section>
  );
}

function toggleSetValue<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function setKindStageExpansion(
  set: ReadonlySet<string>,
  kind: WorkflowKind,
  stageIds: string[],
): ReadonlySet<string> {
  const next = new Set([...set].filter((stageKey) => !stageKey.startsWith(`${kind}:`)));
  for (const stageId of stageIds) {
    next.add(`${kind}:${stageId}`);
  }
  return next;
}
