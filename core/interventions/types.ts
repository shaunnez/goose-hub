import { z } from 'zod';

export const InterventionStatusSchema = z.enum([
  'OPEN',
  'PROPOSED',
  'DECIDED',
  'APPLYING',
  'APPLIED',
  'FAILED',
  'VERIFIED',
  'RESOLVED',
  'ABORTED',
  'SUPERSEDED',
]);

export type InterventionStatus = z.infer<typeof InterventionStatusSchema>;

export const ACTIVE_INTERVENTION_STATUSES: ReadonlySet<InterventionStatus> = new Set([
  'OPEN',
  'PROPOSED',
  'DECIDED',
  'APPLYING',
  'APPLIED',
  'FAILED',
  'VERIFIED',
]);

export const CLOSED_INTERVENTION_STATUSES: ReadonlySet<InterventionStatus> = new Set([
  'RESOLVED',
  'ABORTED',
  'SUPERSEDED',
]);

export const InterventionTypeSchema = z.enum([
  'needs_human',
  'gate_pending',
  'merge_conflict',
  'qa_disagreement',
  'manual_override',
]);

export type InterventionType = z.infer<typeof InterventionTypeSchema>;

export const InterventionActionOptionSchema = z.object({
  actionType: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  payload: z.unknown(),
  risk: z.enum(['low', 'medium', 'high']),
});

export type InterventionActionOption = z.infer<typeof InterventionActionOptionSchema>;

export interface WorkItemIntervention {
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
  proposedOptions: InterventionActionOption[];
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

export interface WorkItemInterventionEvent {
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

export interface OpenInterventionInput {
  projectId: string;
  workItemId: string;
  interventionType: InterventionType;
  title: string;
  reason: string;
  rootCauseSignature: string;
  correlationId?: string;
  sourceEventId?: number | null;
  actor?: string;
  evidence?: unknown;
}

export interface ReducerResult {
  ok: true;
  intervention: WorkItemIntervention;
}

export interface ReducerFailure {
  ok: false;
  error: string;
  status: number;
  current?: WorkItemIntervention;
}

export type InterventionReducerResult = ReducerResult | ReducerFailure;
