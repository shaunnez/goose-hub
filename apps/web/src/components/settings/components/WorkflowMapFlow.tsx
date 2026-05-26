import type {
  ProjectSettingsDto,
  WorkflowBranchDto,
  WorkflowCatalogEntryDto,
  WorkflowNodeDto,
  WorkflowStageDto,
  WorkflowVariantDto,
} from '@/lib/types';
import {
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  CircleDot,
  GitBranch,
  RotateCcw,
  Split,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import {
  type ActivationStatus,
  type EffectiveModes,
  activationStatus,
  isWorkflowNode,
  nodeClass,
  nodeSizeClass,
  panelClass,
  shortState,
} from '../lib/workflow-map';

export function WorkflowMapFlow({
  entry,
  modes,
  settings,
  selectedNodeId,
  onSelectNode,
  expandedStageIds,
  onToggleStage,
}: {
  entry: WorkflowCatalogEntryDto;
  modes: EffectiveModes;
  settings: ProjectSettingsDto | undefined;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  expandedStageIds: ReadonlySet<string>;
  onToggleStage: (stageId: string) => void;
}) {
  const nodesById = useMemo(() => new Map(entry.nodes.map((node) => [node.id, node])), [entry]);

  return (
    <section className="min-w-0 overflow-x-hidden" data-testid="workflow-vertical-flow">
      <div className="min-w-0 space-y-0 overflow-x-hidden">
        {entry.stages.map((stage, index) => (
          <WorkflowStage
            key={stage.id}
            stage={stage}
            nodesById={nodesById}
            modes={modes}
            settings={settings}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            isLast={index === entry.stages.length - 1}
            isCollapsed={!expandedStageIds.has(`${entry.kind}:${stage.id}`)}
            onToggleCollapse={() => onToggleStage(stage.id)}
          />
        ))}
      </div>
    </section>
  );
}

export function StatusBadge({ status, label }: { status: ActivationStatus; label?: string }) {
  const text = status === 'active' ? 'active' : status === 'inactive' ? 'inactive' : 'conditional';
  return (
    <span
      className={[
        'inline-flex max-w-full min-w-0 items-center gap-1 rounded border px-1 py-1 text-[10px] sm:px-2',
        status === 'active'
          ? 'border-accent bg-accent-soft text-fg'
          : status === 'inactive'
            ? 'border-line bg-bg-elev text-fg-3'
            : 'border-line border-dashed bg-bg-subtle text-fg-2',
      ].join(' ')}
      title={label}
    >
      <span className="min-w-0 break-all">{text}</span>
    </span>
  );
}

export function MapBadge({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-line bg-bg-elev px-1 py-1 text-[10px] text-fg-2 sm:px-2">
      {icon}
      <span className="min-w-0 break-all">{label}</span>
    </span>
  );
}

function WorkflowStage({
  stage,
  nodesById,
  modes,
  settings,
  selectedNodeId,
  onSelectNode,
  isLast,
  isCollapsed,
  onToggleCollapse,
}: {
  stage: WorkflowStageDto;
  nodesById: Map<string, WorkflowNodeDto>;
  modes: EffectiveModes;
  settings: ProjectSettingsDto | undefined;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  isLast: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const baseNodes = stage.nodes.map((nodeId) => nodesById.get(nodeId)).filter(isWorkflowNode);
  const bodyId = `workflow-stage-body-${stage.id}`;

  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-2 overflow-x-hidden sm:grid-cols-[24px_minmax(0,1fr)] sm:gap-3"
      data-testid="workflow-stage"
    >
      <div className="hidden flex-col items-center sm:flex">
        <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-bg-elev text-fg-2">
          <CircleDot size={13} />
        </div>
        {!isLast && <div className="h-full min-h-5 w-px bg-line" />}
      </div>

      <div className="min-w-0 overflow-x-hidden pb-5">
        <div className="mb-3">
          <button
            type="button"
            aria-label={stage.title}
            aria-controls={bodyId}
            aria-expanded={!isCollapsed}
            onClick={onToggleCollapse}
            className={[
              'flex w-full min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
              isCollapsed
                ? 'border-line bg-bg-subtle hover:bg-bg-hover'
                : 'border-line/70 bg-bg/30 hover:bg-bg-hover',
            ].join(' ')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-fg-3">
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </span>
              <span className="break-all text-[13px] font-semibold text-fg">{stage.title}</span>
            </span>
            <span className="shrink-0">
              <MapBadge label={stage.group} />
            </span>
          </button>
        </div>

        {!isCollapsed && (
          <div id={bodyId} data-testid={`workflow-stage-body-${stage.id}`}>
            {stage.description != null && (
              <p className="mb-3 max-w-3xl break-all text-[11px] leading-relaxed text-fg-3">
                {stage.description}
              </p>
            )}

            {baseNodes.length > 0 && (
              <NodeRail
                nodes={baseNodes}
                status="active"
                settings={settings}
                modes={modes}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
              />
            )}

            {stage.variants != null && stage.variants.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-2">
                {stage.variants.map((variant) => (
                  <VariantPanel
                    key={variant.id}
                    variant={variant}
                    nodesById={nodesById}
                    modes={modes}
                    settings={settings}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={onSelectNode}
                  />
                ))}
              </div>
            )}

            {stage.branches != null && stage.branches.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-2">
                {stage.branches.map((branch) => (
                  <BranchPanel
                    key={branch.id}
                    branch={branch}
                    nodesById={nodesById}
                    modes={modes}
                    settings={settings}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={onSelectNode}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VariantPanel({
  variant,
  nodesById,
  modes,
  settings,
  selectedNodeId,
  onSelectNode,
}: {
  variant: WorkflowVariantDto;
  nodesById: Map<string, WorkflowNodeDto>;
  modes: EffectiveModes;
  settings: ProjectSettingsDto | undefined;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const status = activationStatus(variant.activation, modes);
  const nodes = variant.nodes.map((nodeId) => nodesById.get(nodeId)).filter(isWorkflowNode);

  return (
    <div className={panelClass(status)} data-testid={`workflow-variant-${variant.id}`}>
      <PanelHeader
        icon={
          variant.mode === 'multi-agent' || variant.mode === 'swarm' ? <Split size={13} /> : null
        }
        title={variant.title}
        description={variant.description}
        status={status}
        label={variant.activation?.label}
      />
      <NodeRail
        nodes={nodes}
        status={status}
        settings={settings}
        modes={modes}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
      />
    </div>
  );
}

function BranchPanel({
  branch,
  nodesById,
  modes,
  settings,
  selectedNodeId,
  onSelectNode,
}: {
  branch: WorkflowBranchDto;
  nodesById: Map<string, WorkflowNodeDto>;
  modes: EffectiveModes;
  settings: ProjectSettingsDto | undefined;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const status =
    branch.kind === 'retry' || branch.kind === 'failure'
      ? 'conditional'
      : branch.kind === 'conditional' && branch.activation == null
        ? 'conditional'
        : activationStatus(branch.activation, modes);
  const nodes = branch.nodes.map((nodeId) => nodesById.get(nodeId)).filter(isWorkflowNode);
  const icon =
    branch.kind === 'retry' ? (
      <RotateCcw size={13} />
    ) : branch.kind === 'failure' ? (
      <AlertTriangle size={13} />
    ) : (
      <GitBranch size={13} />
    );

  return (
    <div className={panelClass(status, true)} data-testid={`workflow-branch-${branch.id}`}>
      <PanelHeader
        icon={icon}
        title={branch.title}
        description={branch.description}
        status={status}
        label={branch.activation?.label}
      />
      <NodeRail
        nodes={nodes}
        status={status}
        settings={settings}
        modes={modes}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
      />
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  description,
  status,
  label,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  status: ActivationStatus;
  label?: string;
}) {
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-fg">
          {icon != null && <span className="shrink-0 text-fg-3">{icon}</span>}
          <span className="min-w-0 break-all">{title}</span>
        </div>
        {description != null && (
          <p className="mt-1 max-w-3xl break-all text-[10px] leading-relaxed text-fg-3">
            {description}
          </p>
        )}
      </div>
      <StatusBadge status={status} label={label} />
    </div>
  );
}

function NodeRail({
  nodes,
  status,
  settings,
  modes,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: WorkflowNodeDto[];
  status: ActivationStatus;
  settings: ProjectSettingsDto | undefined;
  modes: EffectiveModes;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 overflow-x-hidden">
      {nodes.map((node, index) => {
        const nodeStatus =
          node.activation != null ? activationStatus(node.activation, modes) : status;
        return (
          <div
            key={node.id}
            className={[
              'flex min-w-0 flex-col items-center overflow-x-hidden',
              node.skill == null ? 'w-full' : 'w-fit max-w-full',
            ].join(' ')}
          >
            <FlowNode
              node={node}
              settings={settings}
              status={nodeStatus}
              selected={selectedNodeId === node.id}
              onSelect={() => onSelectNode(node.id)}
            />
            {index < nodes.length - 1 && (
              <div className="flex h-5 w-full items-center justify-center text-fg-3">
                <ArrowDown size={12} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FlowNode({
  node,
  settings,
  status,
  selected,
  onSelect,
}: {
  node: WorkflowNodeDto;
  settings: ProjectSettingsDto | undefined;
  status: ActivationStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const runtime = node.skill != null ? settings?.resolvedSkillRuntimes?.[node.skill] : undefined;
  const provider =
    node.skill != null
      ? (runtime?.effectiveProvider ?? settings?.skillDefaults?.[node.skill]?.modelProvider)
      : undefined;
  const isHoldout = node.role === 'qa' || node.role === 'reviewer';
  const canSelect = node.skill != null;
  const Element = canSelect ? 'button' : 'div';

  return (
    <Element
      type={canSelect ? 'button' : undefined}
      onClick={canSelect ? onSelect : undefined}
      className={[
        'min-w-0 rounded-md border px-2 py-2 text-left transition-colors sm:px-3',
        nodeSizeClass(node),
        nodeClass(status, selected, canSelect),
      ].join(' ')}
      data-testid={node.skill != null ? 'workflow-skill-node' : 'workflow-state-node'}
      title={node.notes ?? node.label}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="min-w-0 break-all text-[12px] font-medium">{node.label}</span>
        {node.skill != null && (
          <span className="break-all rounded bg-bg-subtle px-1 py-0.5 font-mono text-[9px] text-fg-3 sm:px-1.5">
            {node.skill}
          </span>
        )}
        {isHoldout && <MiniBadge label="holdout" />}
        {node.role === 'dev-reviewer' && <MiniBadge label="advisor" />}
        {provider === 'codex' && <MiniBadge label="codex" />}
        {node.visual === 'fanout' && <MiniBadge label="fan-out" />}
      </div>
      {node.state != null && (
        <div className="mt-1 break-all font-mono text-[10px] text-fg-3">
          {shortState(node.state)}
        </div>
      )}
      {node.notes != null && (
        <div className="mt-1 text-[10px] leading-snug text-fg-3">{node.notes}</div>
      )}
    </Element>
  );
}

function MiniBadge({ label }: { label: string }) {
  return <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-[9px] text-fg-3">{label}</span>;
}
