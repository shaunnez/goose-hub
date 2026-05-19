import type { ProjectSettingsDto, WorkflowNodeDto } from '@/lib/types';
import { X } from 'lucide-react';
import type { EffectiveModes } from '../lib/workflow-map';
import { activationStatus, shortState } from '../lib/workflow-map';
import { MapBadge, StatusBadge } from './WorkflowMapFlow';

export function WorkflowSkillDetailModal({
  node,
  settings,
  modes,
  onClose,
}: {
  node: WorkflowNodeDto;
  settings: ProjectSettingsDto | undefined;
  modes: EffectiveModes;
  onClose: () => void;
}) {
  const skill = node.skill ?? node.label;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <dialog
        open
        aria-modal="true"
        aria-label={`${skill} details`}
        className="relative m-0 max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-line bg-bg-elev p-4 text-fg shadow-xl backdrop:bg-transparent"
        data-testid="skill-detail-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-fg-3">Skill detail</div>
            <h4 className="mt-1 break-all font-mono text-[14px] font-semibold text-fg">
              {node.label}
              {node.skill != null && <span className="text-fg-3"> / {node.skill}</span>}
            </h4>
          </div>
          <button
            type="button"
            aria-label="Close skill detail"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-bg-subtle text-fg-2 transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
        <SkillDetail node={node} settings={settings} modes={modes} />
      </dialog>
    </div>
  );
}

function SkillDetail({
  node,
  settings,
  modes,
}: {
  node: WorkflowNodeDto;
  settings: ProjectSettingsDto | undefined;
  modes: EffectiveModes;
}) {
  const skill = node.skill ?? '';
  const metadata = settings?.skillMetadata?.[skill];
  const defaults = settings?.skillDefaults?.[skill];
  const runtime = settings?.resolvedSkillRuntimes?.[skill];
  const status = node.activation != null ? activationStatus(node.activation, modes) : 'active';

  return (
    <section className="rounded-md border border-line bg-bg-subtle p-4" data-testid="skill-detail">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
        <h4 className="break-all font-mono text-[13px] font-semibold text-fg">
          {node.label}
          {skill !== '' && <span className="text-fg-3"> / {skill}</span>}
        </h4>
        <StatusBadge status={status} label={node.activation?.label} />
        {node.role != null && <MapBadge label={node.role} />}
        {node.state != null && <MapBadge label={shortState(node.state)} />}
        {runtime?.effectiveProvider === 'codex' && <MapBadge label="codex" />}
      </div>
      {metadata?.description != null && metadata.description !== '' && (
        <p className="mb-3 max-w-3xl text-[12px] leading-relaxed text-fg-2">
          {metadata.description}
        </p>
      )}
      {node.notes != null && (
        <p className="mb-3 max-w-3xl text-[12px] leading-relaxed text-fg-2">{node.notes}</p>
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
        {runtime?.resolutionTrace?.tier != null && (
          <DetailBlock
            label={`Tier from ${runtime.resolutionTrace.tier.source}`}
            values={[
              `${runtime.resolutionTrace.tier.value}: ${runtime.resolutionTrace.tier.reason}`,
            ]}
          />
        )}
        {runtime?.resolutionTrace?.provider != null && (
          <DetailBlock
            label={`Provider from ${runtime.resolutionTrace.provider.source}`}
            values={[
              `${runtime.resolutionTrace.provider.value}: ${runtime.resolutionTrace.provider.reason}`,
            ]}
          />
        )}
        {runtime?.resolutionTrace?.effort != null && (
          <DetailBlock
            label={`Effort from ${runtime.resolutionTrace.effort.source}`}
            values={[
              `${runtime.resolutionTrace.effort.value}: ${runtime.resolutionTrace.effort.reason}`,
            ]}
          />
        )}
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
