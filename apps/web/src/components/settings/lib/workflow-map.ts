import type {
  DevReviewSettingsDto,
  PipelineSettingsDto,
  ProjectSettingsDto,
  ReviewSettingsDto,
  WorkflowActivationDto,
  WorkflowKind,
  WorkflowNodeDto,
} from '@/lib/types';

export const WORKFLOW_KINDS: WorkflowKind[] = ['bug', 'feature', 'chore', 'research'];

export const KIND_LABELS: Record<WorkflowKind, string> = {
  bug: 'Bug',
  feature: 'Feature',
  chore: 'Chore',
  research: 'Research',
};

const DEFAULT_DEV_REVIEW = {
  enabled: false,
  triggerOn: 'priority:high+',
  maxRevisionTurns: 1,
};

export type ActivationStatus = 'active' | 'inactive' | 'conditional';

export type EffectiveModes = {
  useInvestigationSwarm: boolean | null;
  useMultiAgentPipeline: boolean | null;
  devReviewEnabled: boolean;
  devReviewTriggerOn: string;
  devReviewMaxRevisionTurns: number;
  reviewConvergent: boolean | null;
  reviewerSlots: ReviewSettingsDto['reviewerSlots'] | null;
  maxParallelAgents: number | null;
  maxScoutAgents: number | null;
  playwrightReproEnabled: boolean | null;
  evidencePostEnabled: boolean | null;
};

export function buildEffectiveModes(
  settings: ProjectSettingsDto | undefined,
  pipeline: PipelineSettingsDto | undefined,
  devReview: DevReviewSettingsDto | undefined,
  review: ReviewSettingsDto | undefined,
): EffectiveModes {
  const devReviewEnabled =
    devReview?.dbOverride?.enabled ?? devReview?.config?.enabled ?? DEFAULT_DEV_REVIEW.enabled;
  const devReviewTriggerOn =
    devReview?.dbOverride?.triggerOn ??
    devReview?.config?.triggerOn ??
    DEFAULT_DEV_REVIEW.triggerOn;
  const devReviewMaxRevisionTurns =
    devReview?.dbOverride?.maxRevisionTurns ??
    devReview?.config?.maxRevisionTurns ??
    DEFAULT_DEV_REVIEW.maxRevisionTurns;

  return {
    useInvestigationSwarm: pipeline?.useInvestigationSwarm ?? null,
    useMultiAgentPipeline: pipeline?.useMultiAgentPipeline ?? null,
    devReviewEnabled,
    devReviewTriggerOn,
    devReviewMaxRevisionTurns,
    reviewConvergent: pipeline?.useMultiAgentPipeline ?? null,
    reviewerSlots: review?.reviewerSlots ?? null,
    maxParallelAgents:
      settings?.dbGlobalOverrides?.maxParallelAgents ??
      numberConfig(settings?.configBudgets, 'maxParallelAgents'),
    maxScoutAgents:
      settings?.dbGlobalOverrides?.maxScoutAgents ??
      numberConfig(settings?.configBudgets, 'maxScoutAgents'),
    playwrightReproEnabled: numberFlag(settings?.dbPipelineFlags?.playwrightReproEnabled),
    evidencePostEnabled: numberFlag(settings?.dbPipelineFlags?.evidencePostEnabled),
  };
}

export function activationStatus(
  activation: WorkflowActivationDto | undefined,
  modes: EffectiveModes,
): ActivationStatus {
  if (activation == null) return 'active';

  const value = activationValue(activation, modes);
  if (value == null) return 'conditional';
  return value === activation.value ? 'active' : 'inactive';
}

export function panelClass(status: ActivationStatus, branch = false): string {
  return [
    'min-w-0 overflow-x-hidden rounded-md border px-2 py-2 sm:px-3',
    branch ? 'border-dashed' : '',
    status === 'active'
      ? 'border-accent bg-accent-soft'
      : status === 'inactive'
        ? 'border-line bg-bg-subtle opacity-55'
        : 'border-line bg-bg-subtle',
  ].join(' ');
}

export function nodeClass(status: ActivationStatus, selected: boolean, canSelect: boolean): string {
  return [
    selected
      ? 'border-accent bg-accent-soft text-fg'
      : status === 'active'
        ? 'border-line bg-bg-elev text-fg'
        : status === 'inactive'
          ? 'border-line bg-bg-subtle text-fg-3 opacity-65'
          : 'border-line border-dashed bg-bg-subtle text-fg-2',
    canSelect ? 'hover:border-accent/70 hover:text-fg' : '',
  ].join(' ');
}

export function nodeSizeClass(node: WorkflowNodeDto): string {
  return node.skill != null ? 'w-fit max-w-full' : 'w-full';
}

export function isWorkflowNode(node: WorkflowNodeDto | undefined): node is WorkflowNodeDto {
  return node != null;
}

export function modeValue(value: boolean | null): string {
  if (value == null) return 'loading';
  return value ? 'on' : 'off';
}

export function shortState(state: string): string {
  return state.replace('factory:', '');
}

function activationValue(
  activation: WorkflowActivationDto,
  modes: EffectiveModes,
): boolean | string | null {
  switch (activation.setting) {
    case 'useInvestigationSwarm':
      return modes.useInvestigationSwarm;
    case 'useMultiAgentPipeline':
      return modes.useMultiAgentPipeline;
    case 'devReview.enabled':
      return modes.devReviewEnabled;
    case 'review.convergent':
      return modes.reviewConvergent;
    case 'playwrightRepro.enabled':
      return modes.playwrightReproEnabled;
    case 'evidencePost.enabled':
      return modes.evidencePostEnabled;
    case 'workItem.missingPromotionSeed':
    case 'workItem.simpleBug':
    case 'priority.highCritical':
      return null;
  }
}

function numberConfig(config: Record<string, unknown> | undefined, key: string): number | null {
  const value = config?.[key];
  return typeof value === 'number' ? value : null;
}

function numberFlag(value: number | null | undefined): boolean | null {
  if (value == null) return null;
  return value === 1;
}
