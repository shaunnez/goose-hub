import {
  appendInterventionEvent,
  createIntervention,
  findLatestByRootCause,
  getIntervention,
  interventionTimestamp,
  isActiveStatus,
  isClosedStatus,
  listInterventionEvents,
  listInterventions,
  updateInterventionCas,
} from './repository.js';
import type {
  InterventionActionOption,
  InterventionReducerResult,
  InterventionStatus,
  OpenInterventionInput,
  WorkItemIntervention,
} from './types.js';

function conflict(current: WorkItemIntervention | null): InterventionReducerResult {
  return {
    ok: false,
    error: 'intervention version conflict',
    status: 409,
    current: current ?? undefined,
  };
}

function illegal(
  message: string,
  current: WorkItemIntervention | null,
  status = 422,
): InterventionReducerResult {
  return { ok: false, error: message, status, current: current ?? undefined };
}

function canMove(from: InterventionStatus, to: InterventionStatus): boolean {
  if (from === to) return true;
  const graph: Record<InterventionStatus, readonly InterventionStatus[]> = {
    OPEN: ['PROPOSED', 'DECIDED', 'RESOLVED', 'ABORTED', 'SUPERSEDED'],
    PROPOSED: ['DECIDED', 'OPEN', 'RESOLVED', 'ABORTED', 'SUPERSEDED'],
    DECIDED: ['APPLYING', 'OPEN', 'ABORTED', 'SUPERSEDED'],
    APPLYING: ['APPLIED', 'OPEN', 'FAILED', 'ABORTED', 'SUPERSEDED'],
    APPLIED: ['VERIFIED', 'RESOLVED', 'OPEN', 'SUPERSEDED'],
    FAILED: ['OPEN', 'APPLYING', 'ABORTED', 'SUPERSEDED'],
    VERIFIED: ['RESOLVED', 'OPEN', 'SUPERSEDED'],
    RESOLVED: ['OPEN', 'SUPERSEDED'],
    ABORTED: ['OPEN', 'SUPERSEDED'],
    SUPERSEDED: [],
  };
  return graph[from].includes(to);
}

function hasSeenSourceEvent(
  intervention: WorkItemIntervention,
  sourceEventId?: number | null,
): boolean {
  if (sourceEventId == null) return false;
  if (intervention.sourceEventId === sourceEventId) return true;
  return listInterventionEvents(intervention.id).some((event) => {
    if (event.payload == null || typeof event.payload !== 'object') return false;
    const payload = event.payload as Record<string, unknown>;
    return payload.sourceEventId === sourceEventId;
  });
}

function transition(input: {
  id: string;
  expectedVersion: number;
  to: InterventionStatus;
  eventType: string;
  actor: string;
  patch?: Record<string, unknown>;
  payload?: unknown;
}): InterventionReducerResult {
  const current = getIntervention(input.id);
  if (current == null) return illegal('intervention not found', null, 404);
  if (current.version !== input.expectedVersion) return conflict(current);
  if (!canMove(current.status, input.to)) {
    return illegal(`illegal intervention transition ${current.status} -> ${input.to}`, current);
  }

  const updated = updateInterventionCas({
    id: current.id,
    expectedVersion: input.expectedVersion,
    patch: {
      ...input.patch,
      status: input.to,
      ...(input.to === 'RESOLVED' ? { resolvedAt: interventionTimestamp() } : {}),
      ...(input.to === 'OPEN' ? { resolvedAt: null, leaseOwner: null, leaseExpiresAt: null } : {}),
    },
  });
  if (updated == null) return conflict(getIntervention(input.id));
  appendInterventionEvent({
    intervention: updated,
    eventType: input.eventType,
    actor: input.actor,
    fromStatus: current.status,
    toStatus: updated.status,
    payload: input.payload,
  });
  return { ok: true, intervention: updated };
}

export function open(input: OpenInterventionInput): InterventionReducerResult {
  const existing = findLatestByRootCause(input);
  if (existing != null && isActiveStatus(existing.status)) {
    if (hasSeenSourceEvent(existing, input.sourceEventId)) {
      return { ok: true, intervention: existing };
    }
    appendInterventionEvent({
      intervention: existing,
      eventType: 'dedupe',
      actor: input.actor ?? 'projector',
      fromStatus: existing.status,
      toStatus: existing.status,
      payload: { sourceEventId: input.sourceEventId ?? null, evidence: input.evidence ?? null },
    });
    return { ok: true, intervention: existing };
  }
  if (existing != null && isClosedStatus(existing.status)) {
    if (hasSeenSourceEvent(existing, input.sourceEventId)) {
      return { ok: true, intervention: existing };
    }
    return reopen({
      id: existing.id,
      expectedVersion: existing.version,
      actor: input.actor ?? 'projector',
      reason: input.reason,
      evidence: input.evidence,
      sourceEventId: input.sourceEventId ?? null,
    });
  }
  return { ok: true, intervention: createIntervention(input) };
}

export function propose(input: {
  id: string;
  expectedVersion: number;
  options: InterventionActionOption[];
  actor?: string;
  evidence?: unknown;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'PROPOSED',
    eventType: 'propose',
    actor: input.actor ?? 'intervention-proposer',
    patch: { proposedOptionsJson: JSON.stringify(input.options) },
    payload: { options: input.options, evidence: input.evidence ?? null },
  });
}

export function decide(input: {
  id: string;
  expectedVersion: number;
  actionType: string;
  actionPayload: unknown;
  decidedBy: string;
  reason?: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'DECIDED',
    eventType: 'decide',
    actor: input.decidedBy,
    patch: {
      decidedActionType: input.actionType,
      decidedActionPayloadJson: JSON.stringify(input.actionPayload ?? null),
      decidedBy: input.decidedBy,
      decisionReason: input.reason ?? null,
    },
    payload: {
      actionType: input.actionType,
      actionPayload: input.actionPayload,
      reason: input.reason ?? null,
    },
  });
}

export function markApplying(input: {
  id: string;
  expectedVersion: number;
  leaseOwner: string;
  leaseExpiresAt: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'APPLYING',
    eventType: 'markApplying',
    actor: input.leaseOwner,
    patch: { leaseOwner: input.leaseOwner, leaseExpiresAt: input.leaseExpiresAt },
    payload: { leaseExpiresAt: input.leaseExpiresAt },
  });
}

export function recordApplicationResult(input: {
  id: string;
  expectedVersion: number;
  ok: boolean;
  result: unknown;
  actor?: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: input.ok ? 'APPLIED' : 'FAILED',
    eventType: 'recordApplicationResult',
    actor: input.actor ?? 'intervention-applier',
    patch: {
      applicationResultJson: JSON.stringify({ ok: input.ok, result: input.result }),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    payload: { ok: input.ok, result: input.result },
  });
}

export function verify(input: {
  id: string;
  expectedVersion: number;
  verification: unknown;
  actor?: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'VERIFIED',
    eventType: 'verify',
    actor: input.actor ?? 'intervention-verifier',
    patch: { verificationJson: JSON.stringify(input.verification ?? null) },
    payload: { verification: input.verification },
  });
}

export function resolve(input: {
  id: string;
  expectedVersion: number;
  reason?: string;
  actor?: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'RESOLVED',
    eventType: 'resolve',
    actor: input.actor ?? 'system',
    payload: { reason: input.reason ?? null },
  });
}

export function reopen(input: {
  id: string;
  expectedVersion: number;
  reason: string;
  evidence?: unknown;
  sourceEventId?: number | null;
  actor?: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'OPEN',
    eventType: 'reopen',
    actor: input.actor ?? 'projector',
    patch: {
      reason: input.reason,
      sourceEventId: input.sourceEventId ?? null,
      proposedOptionsJson: '[]',
      decidedActionType: null,
      decidedActionPayloadJson: null,
      decidedBy: null,
      decisionReason: null,
      applicationResultJson: null,
      verificationJson: null,
    },
    payload: { reason: input.reason, evidence: input.evidence ?? null },
  });
}

export function abort(input: {
  id: string;
  expectedVersion: number;
  reason: string;
  actor: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'ABORTED',
    eventType: 'abort',
    actor: input.actor,
    payload: { reason: input.reason },
  });
}

export function supersede(input: {
  id: string;
  expectedVersion: number;
  supersededBy: string;
  actor?: string;
}): InterventionReducerResult {
  return transition({
    id: input.id,
    expectedVersion: input.expectedVersion,
    to: 'SUPERSEDED',
    eventType: 'supersede',
    actor: input.actor ?? 'system',
    payload: { supersededBy: input.supersededBy },
  });
}

export function recoverStaleApplying(
  input: {
    now?: Date;
    actor?: string;
  } = {},
): WorkItemIntervention[] {
  const nowMs = (input.now ?? new Date()).getTime();
  const recovered: WorkItemIntervention[] = [];
  for (const intervention of listInterventions({ status: 'APPLYING', limit: 500 })) {
    if (intervention.leaseExpiresAt != null && Date.parse(intervention.leaseExpiresAt) > nowMs) {
      continue;
    }
    const result = reopen({
      id: intervention.id,
      expectedVersion: intervention.version,
      reason: 'stale APPLYING lease recovered',
      evidence: {
        leaseOwner: intervention.leaseOwner,
        leaseExpiresAt: intervention.leaseExpiresAt,
      },
      actor: input.actor ?? 'intervention-recovery',
    });
    if (result.ok) recovered.push(result.intervention);
  }
  return recovered;
}
