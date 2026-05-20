import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db/db.js';
import { workItemInterventionEvents, workItemInterventions } from '../db/schema.js';
import {
  ACTIVE_INTERVENTION_STATUSES,
  CLOSED_INTERVENTION_STATUSES,
  type InterventionActionOption,
  InterventionActionOptionSchema,
  InterventionStatusSchema,
  InterventionTypeSchema,
  type OpenInterventionInput,
  type WorkItemIntervention,
  type WorkItemInterventionEvent,
} from './types.js';

export function interventionTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseJson(value: string | null | undefined, fallback: unknown): unknown {
  if (value == null || value.length === 0) return fallback;
  return JSON.parse(value);
}

function parseOptions(value: string): InterventionActionOption[] {
  return InterventionActionOptionSchema.array().parse(parseJson(value, []));
}

function toIntervention(row: typeof workItemInterventions.$inferSelect): WorkItemIntervention {
  return {
    id: row.id,
    projectId: row.projectId,
    workItemId: row.workItemId,
    interventionType: InterventionTypeSchema.parse(row.interventionType),
    status: InterventionStatusSchema.parse(row.status),
    title: row.title,
    reason: row.reason,
    rootCauseSignature: row.rootCauseSignature,
    correlationId: row.correlationId,
    sourceEventId: row.sourceEventId,
    proposedOptions: parseOptions(row.proposedOptionsJson),
    decidedActionType: row.decidedActionType,
    decidedActionPayload: parseJson(row.decidedActionPayloadJson, null),
    decidedBy: row.decidedBy,
    decisionReason: row.decisionReason,
    applicationResult: parseJson(row.applicationResultJson, null),
    verification: parseJson(row.verificationJson, null),
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  };
}

function toEvent(row: typeof workItemInterventionEvents.$inferSelect): WorkItemInterventionEvent {
  return {
    id: row.id,
    interventionId: row.interventionId,
    projectId: row.projectId,
    workItemId: row.workItemId,
    eventType: row.eventType,
    actor: row.actor,
    fromStatus: row.fromStatus == null ? null : InterventionStatusSchema.parse(row.fromStatus),
    toStatus: row.toStatus == null ? null : InterventionStatusSchema.parse(row.toStatus),
    payload: parseJson(row.payloadJson, {}),
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  };
}

export function listInterventions(filter: {
  projectId?: string;
  workItemId?: string;
  status?: string | string[];
  limit?: number;
}): WorkItemIntervention[] {
  const conditions = [];
  if (filter.projectId != null)
    conditions.push(eq(workItemInterventions.projectId, filter.projectId));
  if (filter.workItemId != null)
    conditions.push(eq(workItemInterventions.workItemId, filter.workItemId));
  if (filter.status != null) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(inArray(workItemInterventions.status, statuses));
  }

  const rows = db
    .select()
    .from(workItemInterventions)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(workItemInterventions.updatedAt))
    .limit(filter.limit ?? 100)
    .all();
  return rows.map(toIntervention);
}

export function listOpenInterventionsReadyForProposal(filter: {
  projectId?: string;
  now: string;
  limit?: number;
}): WorkItemIntervention[] {
  const conditions = [
    eq(workItemInterventions.status, 'OPEN'),
    or(
      and(isNull(workItemInterventions.leaseOwner), isNull(workItemInterventions.leaseExpiresAt)),
      lte(workItemInterventions.leaseExpiresAt, filter.now),
    ),
  ];
  if (filter.projectId != null) {
    conditions.push(eq(workItemInterventions.projectId, filter.projectId));
  }

  const rows = db
    .select()
    .from(workItemInterventions)
    .where(and(...conditions))
    .orderBy(desc(workItemInterventions.updatedAt))
    .limit(filter.limit ?? 100)
    .all();
  return rows.map(toIntervention);
}

export function getIntervention(id: string): WorkItemIntervention | null {
  const rows = db
    .select()
    .from(workItemInterventions)
    .where(eq(workItemInterventions.id, id))
    .limit(1)
    .all();
  return rows[0] == null ? null : toIntervention(rows[0]);
}

export function listInterventionEvents(id: string): WorkItemInterventionEvent[] {
  return db
    .select()
    .from(workItemInterventionEvents)
    .where(eq(workItemInterventionEvents.interventionId, id))
    .orderBy(workItemInterventionEvents.id)
    .all()
    .map(toEvent);
}

export function findLatestByRootCause(input: {
  projectId: string;
  workItemId: string;
  rootCauseSignature: string;
}): WorkItemIntervention | null {
  const rows = db
    .select()
    .from(workItemInterventions)
    .where(
      and(
        eq(workItemInterventions.projectId, input.projectId),
        eq(workItemInterventions.workItemId, input.workItemId),
        eq(workItemInterventions.rootCauseSignature, input.rootCauseSignature),
      ),
    )
    .orderBy(desc(workItemInterventions.updatedAt))
    .limit(1)
    .all();
  return rows[0] == null ? null : toIntervention(rows[0]);
}

export function appendInterventionEvent(input: {
  intervention: WorkItemIntervention;
  eventType: string;
  actor: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  payload?: unknown;
}): void {
  db.insert(workItemInterventionEvents)
    .values({
      interventionId: input.intervention.id,
      projectId: input.intervention.projectId,
      workItemId: input.intervention.workItemId,
      eventType: input.eventType,
      actor: input.actor,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      payloadJson: JSON.stringify(input.payload ?? {}),
      correlationId: input.intervention.correlationId,
    })
    .run();
}

export function createIntervention(input: OpenInterventionInput): WorkItemIntervention {
  const id = randomUUID();
  const correlationId = input.correlationId ?? randomUUID();
  db.insert(workItemInterventions)
    .values({
      id,
      projectId: input.projectId,
      workItemId: input.workItemId,
      interventionType: input.interventionType,
      status: 'OPEN',
      title: input.title,
      reason: input.reason,
      rootCauseSignature: input.rootCauseSignature,
      correlationId,
      sourceEventId: input.sourceEventId ?? null,
    })
    .run();
  const intervention = getIntervention(id);
  if (intervention == null) throw new Error(`failed to create intervention ${id}`);
  appendInterventionEvent({
    intervention,
    eventType: 'open',
    actor: input.actor ?? 'projector',
    toStatus: 'OPEN',
    payload: { evidence: input.evidence ?? null },
  });
  return intervention;
}

export function updateInterventionCas(input: {
  id: string;
  expectedVersion: number;
  patch: Partial<typeof workItemInterventions.$inferInsert>;
}): WorkItemIntervention | null {
  const rows = db
    .update(workItemInterventions)
    .set({
      ...input.patch,
      version: input.expectedVersion + 1,
      updatedAt: interventionTimestamp(),
    })
    .where(
      and(
        eq(workItemInterventions.id, input.id),
        eq(workItemInterventions.version, input.expectedVersion),
      ),
    )
    .returning()
    .all();
  return rows[0] == null ? null : toIntervention(rows[0]);
}

export function isActiveStatus(status: string): boolean {
  return ACTIVE_INTERVENTION_STATUSES.has(InterventionStatusSchema.parse(status));
}

export function isClosedStatus(status: string): boolean {
  return CLOSED_INTERVENTION_STATUSES.has(InterventionStatusSchema.parse(status));
}
