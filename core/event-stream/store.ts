import { EventEmitter } from 'node:events';
import { type SQL, and, asc, desc, eq, gt, inArray, isNotNull, lt } from 'drizzle-orm';
import { db } from '../db/db.js';
import { events } from '../db/schema.js';
import { redactSecrets } from '../tool-layer/secret-redaction.js';
import type { EventKind } from './kinds.js';

export type { EventKind } from './kinds.js';

export interface AgentEvent {
  id: number;
  projectId: string;
  workItemId: string | null;
  kind: EventKind;
  payload: unknown;
  runId?: string | null;
  personaId?: string | null;
  createdAt: string;
}

export interface AppendEventInput {
  projectId: string;
  workItemId?: string | null;
  kind: EventKind;
  payload: unknown;
  runId?: string | null;
  personaId?: string | null;
}

class EventStore {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  /**
   * Single writer for the event stream. SQLite write happens first; only after
   * the row is durable do we notify listeners. Callers must NOT write to
   * `events` directly; the linter enforces this in CI.
   */
  appendEvent(input: AppendEventInput): AgentEvent {
    const redacted = redactSecrets(input.payload);
    const payload = JSON.stringify(redacted ?? {});
    const inserted = db
      .insert(events)
      .values({
        projectId: input.projectId,
        workItemId: input.workItemId ?? null,
        kind: input.kind,
        payload,
        runId: input.runId ?? null,
        personaId: input.personaId ?? null,
      })
      .returning()
      .all();

    const row = inserted[0];
    const event: AgentEvent = {
      id: row.id,
      projectId: row.projectId,
      workItemId: row.workItemId,
      kind: row.kind as EventKind,
      payload: JSON.parse(row.payload),
      runId: row.runId,
      personaId: row.personaId,
      createdAt: row.createdAt,
    };

    this.emitter.emit('event', event);
    return event;
  }

  /**
   * Replay events with id > sinceId, ordered by id ascending. Used by SSE for
   * Last-Event-ID resumption.
   */
  replay(
    filter: {
      projectId?: string;
      workItemId?: string;
      sinceId?: number;
      runId?: string;
      kind?: string;
      /** Cursor: only return events with id < before (pagination, older events). */
      before?: number;
      /** Default 'asc'. Use 'desc' for paginated newest-first fetches. */
      order?: 'asc' | 'desc';
      limit?: number;
    } = {},
  ): AgentEvent[] {
    const conditions: SQL[] = [];
    if (filter.projectId != null) conditions.push(eq(events.projectId, filter.projectId));
    if (filter.workItemId != null) conditions.push(eq(events.workItemId, filter.workItemId));
    if (filter.sinceId != null) conditions.push(gt(events.id, filter.sinceId));
    if (filter.before != null) conditions.push(lt(events.id, filter.before));
    if (filter.runId != null) conditions.push(eq(events.runId, filter.runId));
    if (filter.kind != null) conditions.push(eq(events.kind, filter.kind));

    const where =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const orderBy = filter.order === 'desc' ? desc(events.id) : asc(events.id);
    const baseQuery =
      where != null
        ? db.select().from(events).where(where).orderBy(orderBy)
        : db.select().from(events).orderBy(orderBy);
    const rows = filter.limit != null ? baseQuery.limit(filter.limit).all() : baseQuery.all();

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      workItemId: r.workItemId,
      kind: r.kind as EventKind,
      payload: JSON.parse(r.payload),
      runId: r.runId,
      personaId: r.personaId,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Subscribe to live events. The supplied listener is wrapped so that any
   * error it throws is caught and logged ONCE per error-shape (deduped on
   * `name + message`). A broken forwarder must not be able to abort the
   * orchestrator run that's producing the events (#220).
   *
   * Trade-off: dedup is process-lifetime — long-lived processes will not
   * re-warn about the same error after the first occurrence. Acceptable for
   * a single-user local-first tool; revisit if log noise becomes a problem.
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    const seenErrorShapes = new Set<string>();
    const safeListener = (event: AgentEvent): void => {
      try {
        listener(event);
      } catch (err) {
        const e = err as { name?: string; message?: string };
        const shape = `${e?.name ?? 'Error'}: ${e?.message ?? '<no message>'}`;
        if (!seenErrorShapes.has(shape)) {
          seenErrorShapes.add(shape);
          console.error(`[event-stream] subscriber threw (logged once): ${shape}`);
        }
      }
    };
    this.emitter.on('event', safeListener);
    return () => this.emitter.off('event', safeListener);
  }

  /**
   * Delete all events recorded for a single work item. Test-only escape
   * hatch: the E2E pipeline harness reuses sequential issue numbers across
   * runs, so without clearing prior events the retry counters in
   * `core/retry/retry-counter.ts` count completed events from earlier runs
   * and escalate the very first qa.completed of a fresh issue. Production
   * code paths must NOT call this — there's no UI surface for it and the
   * audit trail is meant to be append-only (FACTORY_RULES rule 3).
   */
  deleteByWorkItem(workItemId: string): number {
    const result = db.delete(events).where(eq(events.workItemId, workItemId)).run();
    return result.changes;
  }

  /**
   * On server startup, find any runs that started but never completed (server
   * crashed mid-run). Emit a synthetic agent.run-failed for each so the UI
   * doesn't show them as "Live" forever. Returns the number of runs closed.
   */
  closeOrphanedRuns(): number {
    const startedRows = db
      .select({
        runId: events.runId,
        projectId: events.projectId,
        workItemId: events.workItemId,
      })
      .from(events)
      .where(and(eq(events.kind, 'agent.run-started'), isNotNull(events.runId)))
      .all();

    if (startedRows.length === 0) return 0;

    const closedRows = db
      .selectDistinct({ runId: events.runId })
      .from(events)
      .where(
        and(
          inArray(events.kind, ['agent.run-completed', 'agent.run-failed'] as EventKind[]),
          isNotNull(events.runId),
        ),
      )
      .all();

    const closedIds = new Set(closedRows.map((r) => r.runId).filter((id) => id != null));
    const seen = new Set<string>();

    for (const row of startedRows) {
      if (row.runId == null || seen.has(row.runId) || closedIds.has(row.runId)) continue;
      seen.add(row.runId);
      this.appendEvent({
        projectId: row.projectId,
        workItemId: row.workItemId,
        kind: 'agent.run-failed',
        payload: { error: 'Server restarted — run orphaned', orphaned: true },
        runId: row.runId,
      });
    }

    return seen.size;
  }
}

export const eventStore = new EventStore();
