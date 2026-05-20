import type {
  InterventionActionOption,
  InterventionActionType,
  InterventionStatus,
  InterventionType,
  WorkItemIntervention,
  WorkItemInterventionEvent,
} from '@goose-hub/core/interventions/index.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';

export interface InterventionOptionDto {
  actionType: InterventionActionType | string;
  label: string;
  description: string;
  payload: unknown;
  risk: 'low' | 'medium' | 'high';
}

export interface InterventionDto {
  id: string;
  projectId: string;
  workItemId: string;
  interventionType: InterventionType;
  status: InterventionStatus;
  title: string;
  reason: string;
  rootCauseSignature: string;
  correlationId: string;
  sourceEventId: number | null;
  proposedOptions: InterventionOptionDto[];
  decidedActionType: string | null;
  decidedActionPayload: unknown | null;
  decidedBy: string | null;
  decisionReason: string | null;
  applicationResult: unknown | null;
  verification: unknown | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface InterventionEventDto {
  id: number;
  interventionId: string;
  projectId: string;
  workItemId: string;
  eventType: string;
  actor: string;
  fromStatus: InterventionStatus | null;
  toStatus: InterventionStatus | null;
  payload: unknown;
  correlationId: string;
  createdAt: string;
}

export interface InterventionDetailDto {
  intervention: InterventionDto;
  events: InterventionEventDto[];
}

export interface InterventionsListDto {
  interventions: InterventionDto[];
}

export interface DecideInterventionRequestDto {
  actionType: string;
  actionPayload: unknown;
  expectedVersion: number;
  decidedBy?: string;
  reason?: string;
}

export interface LegalTargetsDto {
  from: StateName;
  legalTargets: readonly StateName[];
}

function toInterventionOptionDto(option: InterventionActionOption): InterventionOptionDto {
  return {
    actionType: option.actionType,
    label: option.label,
    description: option.description,
    payload: option.payload,
    risk: option.risk,
  };
}

export function toInterventionDto(intervention: WorkItemIntervention): InterventionDto {
  return {
    id: intervention.id,
    projectId: intervention.projectId,
    workItemId: intervention.workItemId,
    interventionType: intervention.interventionType,
    status: intervention.status,
    title: intervention.title,
    reason: intervention.reason,
    rootCauseSignature: intervention.rootCauseSignature,
    correlationId: intervention.correlationId,
    sourceEventId: intervention.sourceEventId,
    proposedOptions: intervention.proposedOptions.map(toInterventionOptionDto),
    decidedActionType: intervention.decidedActionType,
    decidedActionPayload: intervention.decidedActionPayload,
    decidedBy: intervention.decidedBy,
    decisionReason: intervention.decisionReason,
    applicationResult: intervention.applicationResult,
    verification: intervention.verification,
    leaseOwner: intervention.leaseOwner,
    leaseExpiresAt: intervention.leaseExpiresAt,
    version: intervention.version,
    createdAt: intervention.createdAt,
    updatedAt: intervention.updatedAt,
    resolvedAt: intervention.resolvedAt,
  };
}

export function toInterventionEventDto(event: WorkItemInterventionEvent): InterventionEventDto {
  return {
    id: event.id,
    interventionId: event.interventionId,
    projectId: event.projectId,
    workItemId: event.workItemId,
    eventType: event.eventType,
    actor: event.actor,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    payload: event.payload,
    correlationId: event.correlationId,
    createdAt: event.createdAt,
  };
}
