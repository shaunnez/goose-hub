import { fetchProjectSettings, fetchWorkflowCatalog } from '@/lib/api';
import type {
  ProjectSettingsDto,
  WorkflowCatalogEntryDto,
  WorkflowEdgeDto,
  WorkflowKind,
  WorkflowNodeDto,
} from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, GitBranch, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

const WORKFLOW_KINDS: WorkflowKind[] = ['bug', 'feature', 'chore', 'research'];

const KIND_LABELS: Record<WorkflowKind, string> = {
  bug: 'Bug',
  feature: 'Feature',
  chore: 'Chore',
  research: 'Research',
};

interface WorkflowMapPanelProps {
  slug: string;
}

export function WorkflowMapPanel({ slug }: WorkflowMapPanelProps) {
  const [kind, setKind] = useState<WorkflowKind>('bug');
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: ['workflow-catalog'],
    queryFn: ({ signal }) => fetchWorkflowCatalog(signal),
  });
  const settingsQuery = useQuery<ProjectSettingsDto>({
    queryKey: ['project-settings', slug],
    queryFn: ({ signal }) => fetchProjectSettings(slug, signal),
  });

  const entry = catalogQuery.data?.catalog.find((candidate) => candidate.kind === kind) ?? null;
  const selectedSkillNode = entry?.nodes.find((node) => node.skill === selectedSkill) ?? null;

  return (
    <div className="min-w-0 max-w-6xl overflow-x-hidden">
      <section className="mb-5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
          Workflow map
        </h3>
        <div className="flex w-full flex-wrap gap-1 rounded-md border border-line bg-bg-subtle p-1">
          {WORKFLOW_KINDS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => {
                setKind(candidate);
                setSelectedSkill(null);
              }}
              className={[
                'min-w-20 flex-1 rounded px-3 py-1.5 text-[12px] transition-colors',
                kind === candidate
                  ? 'bg-accent-soft text-fg font-medium'
                  : 'text-fg-2 hover:bg-bg-hover hover:text-fg',
              ].join(' ')}
            >
              {KIND_LABELS[candidate]}
            </button>
          ))}
        </div>
      </section>

      {catalogQuery.isLoading && <p className="text-[12px] text-fg-3">Loading workflow map...</p>}
      {catalogQuery.error && (
        <p className="text-[12px] text-danger">Failed to load workflow map.</p>
      )}

      {entry != null && (
        <>
          <section className="mb-5">
            <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-[14px] font-semibold text-fg">{entry.title}</h4>
                <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-fg-2">
                  {entry.description}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <MapBadge icon={<ShieldCheck size={12} />} label="QA/review holdouts" />
                <MapBadge icon={<Info size={12} />} label="dev-review codex" />
              </div>
            </div>
            <StateLane
              entry={entry}
              settings={settingsQuery.data}
              onSelectSkill={setSelectedSkill}
              selectedSkill={selectedSkill}
            />
          </section>

          <section className="mb-5">
            <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-fg-2">
              Conditional paths
            </h4>
            <BranchList entry={entry} />
          </section>

          {selectedSkillNode != null && (
            <SkillDetail node={selectedSkillNode} settings={settingsQuery.data} />
          )}
        </>
      )}
    </div>
  );
}

function StateLane({
  entry,
  settings,
  selectedSkill,
  onSelectSkill,
}: {
  entry: WorkflowCatalogEntryDto;
  settings: ProjectSettingsDto | undefined;
  selectedSkill: string | null;
  onSelectSkill: (skill: string) => void;
}) {
  const nodesById = useMemo(() => new Map(entry.nodes.map((node) => [node.id, node])), [entry]);
  const skillsByState = useMemo(() => {
    const grouped = new Map<string, WorkflowNodeDto[]>();
    for (const node of entry.nodes) {
      if (node.skill == null || node.state == null) continue;
      const bucket = grouped.get(node.state) ?? [];
      bucket.push(node);
      grouped.set(node.state, bucket);
    }
    return grouped;
  }, [entry]);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
      {entry.normalPath.map((nodeId, index) => {
        const node = nodesById.get(nodeId);
        if (node == null) return null;
        const stateSkills = node.state != null ? (skillsByState.get(node.state) ?? []) : [];
        return (
          <div
            key={nodeId}
            className="min-w-0 rounded-md border border-line bg-bg-subtle p-3"
            data-testid="workflow-state-node"
          >
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase text-fg-3">Step {index + 1}</div>
                <div className="truncate text-[12px] font-medium text-fg">{node.label}</div>
              </div>
              {index < entry.normalPath.length - 1 && (
                <ArrowRight className="shrink-0 text-fg-3" size={13} />
              )}
            </div>
            {node.state != null && (
              <div className="mb-2 break-all font-mono text-[10px] text-fg-3">
                {shortState(node.state)}
              </div>
            )}
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {stateSkills.map((skillNode) => (
                <SkillChip
                  key={skillNode.id}
                  node={skillNode}
                  settings={settings}
                  selected={selectedSkill === skillNode.skill}
                  onSelect={() => skillNode.skill != null && onSelectSkill(skillNode.skill)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SkillChip({
  node,
  settings,
  selected,
  onSelect,
}: {
  node: WorkflowNodeDto;
  settings: ProjectSettingsDto | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const skill = node.skill ?? '';
  const metadata = settings?.skillMetadata?.[skill];
  const runtime = settings?.resolvedSkillRuntimes?.[skill];
  const isHoldout = skill === 'qa' || skill === 'review';
  const provider = runtime?.effectiveProvider ?? settings?.skillDefaults?.[skill]?.modelProvider;
  const titleParts = [
    metadata?.description,
    metadata?.dependencies?.length ? `Depends: ${metadata.dependencies.join(', ')}` : null,
    metadata?.callers?.length ? `Called by: ${metadata.callers.join(', ')}` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      title={titleParts.join('\n') || skill}
      onClick={onSelect}
      className={[
        'min-w-0 max-w-full rounded border px-2 py-1 text-left font-mono text-[10px] leading-tight transition-colors',
        selected
          ? 'border-accent bg-accent-soft text-fg'
          : 'border-line bg-bg-elev text-fg-2 hover:border-accent/70 hover:text-fg',
      ].join(' ')}
    >
      <span className="break-all">{skill}</span>
      {(isHoldout || provider === 'codex') && (
        <span className="ml-1 inline-flex rounded bg-bg-subtle px-1 text-[9px] text-fg-3">
          {isHoldout ? 'holdout' : 'codex'}
        </span>
      )}
    </button>
  );
}

function BranchList({ entry }: { entry: WorkflowCatalogEntryDto }) {
  const nodesById = new Map(entry.nodes.map((node) => [node.id, node]));
  const branches = entry.edges.filter((edge) => edge.kind === 'optional' || edge.kind === 'retry');

  if (branches.length === 0) {
    return <p className="text-[12px] text-fg-3">No conditional branches recorded.</p>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
      {branches.map((edge) => (
        <BranchRow
          key={`${edge.from}-${edge.to}-${edge.label ?? ''}`}
          edge={edge}
          from={nodesById.get(edge.from)}
          to={nodesById.get(edge.to)}
        />
      ))}
    </div>
  );
}

function BranchRow({
  edge,
  from,
  to,
}: {
  edge: WorkflowEdgeDto;
  from: WorkflowNodeDto | undefined;
  to: WorkflowNodeDto | undefined;
}) {
  const Icon = edge.kind === 'retry' ? RotateCcw : GitBranch;
  return (
    <div className="min-w-0 rounded-md border border-line/70 bg-bg-subtle px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 shrink-0 text-fg-3" size={13} />
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-fg">
            <span className="break-words">{from?.label ?? edge.from}</span>
            <span className="mx-1 text-fg-3">to</span>
            <span className="break-words">{to?.label ?? edge.to}</span>
          </div>
          {(edge.label != null || edge.condition != null) && (
            <div className="mt-1 text-[10px] leading-snug text-fg-3">
              {[edge.label, edge.condition].filter(Boolean).join(' / ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillDetail({
  node,
  settings,
}: {
  node: WorkflowNodeDto;
  settings: ProjectSettingsDto | undefined;
}) {
  const skill = node.skill ?? '';
  const metadata = settings?.skillMetadata?.[skill];
  const defaults = settings?.skillDefaults?.[skill];
  const runtime = settings?.resolvedSkillRuntimes?.[skill];

  return (
    <section className="rounded-md border border-line bg-bg-subtle p-4" data-testid="skill-detail">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
        <h4 className="break-all font-mono text-[13px] font-semibold text-fg">{skill}</h4>
        {node.role != null && <MapBadge label={node.role} />}
        {runtime?.effectiveProvider === 'codex' && <MapBadge label="codex" />}
      </div>
      {metadata?.description != null && metadata.description !== '' && (
        <p className="mb-3 max-w-3xl text-[12px] leading-relaxed text-fg-2">
          {metadata.description}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 text-[11px]">
        <DetailBlock label="Depends on" values={metadata?.dependencies ?? []} />
        <DetailBlock label="Called by" values={metadata?.callers ?? []} />
        <DetailBlock
          label="Runtime default"
          values={[
            defaults != null
              ? `${defaults.modelProvider} ${defaults.modelTier}, ${defaults.maxTurns} turns, $${defaults.maxBudgetUsd.toFixed(2)}`
              : 'Not registered',
          ]}
        />
        <DetailBlock
          label="Resolved primary"
          values={[
            runtime?.resolvedPrimary != null
              ? `${runtime.resolvedPrimary.provider} ${runtime.resolvedPrimary.modelId}`
              : 'Inherits default',
          ]}
        />
      </div>
    </section>
  );
}

function DetailBlock({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] uppercase text-fg-3">{label}</div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {values.length === 0 ? (
          <span className="text-fg-3">None</span>
        ) : (
          values.map((value) => (
            <span
              key={value}
              className="max-w-full break-all rounded border border-line bg-bg-elev px-1.5 py-0.5 text-fg-2"
            >
              {value}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function MapBadge({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line bg-bg-elev px-2 py-1 text-[10px] text-fg-2">
      {icon}
      {label}
    </span>
  );
}

function shortState(state: string): string {
  return state.replace('factory:', '');
}
