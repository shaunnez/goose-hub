import { EventEmitter } from 'node:events';
import { type SQL, and, asc, eq, gt } from 'drizzle-orm';
import { db } from '../db/db.js';
import { events } from '../db/schema.js';
import { redactSecrets } from '../tool-layer/secret-redaction.js';

export type EventKind =
  | 'state.transitioned'
  | 'milestone.activated'
  | 'agent.spawned'
  | 'agent.decision-summary'
  | 'agent.log'
  | 'agent.terminated'
  | 'gate.awaiting-human'
  | 'system.note'
  | 'manual.action'
  | 'agent.tool-call'
  | 'tool.stdout-truncated'
  | 'tool.timeout'
  | 'agent.run-started'
  | 'agent.run-completed'
  | 'agent.run-failed'
  | 'agent.fallback-triggered';

export interface AgentEvent {
  id: number;
  projectId: string;
  workItemId: string | null;
  kind: EventKind;
  payload: unknown;
  runId?: string | null;
  createdAt: string;
}

export interface AppendEventInput {
  projectId: string;
  workItemId?: string | null;
  kind: EventKind;
  payload: unknown;
  runId?: string | null;
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
    filter: { projectId?: string; workItemId?: string; sinceId?: number; runId?: string } = {},
  ): AgentEvent[] {
    const conditions: SQL[] = [];
    if (filter.projectId != null) conditions.push(eq(events.projectId, filter.projectId));
    if (filter.workItemId != null) conditions.push(eq(events.workItemId, filter.workItemId));
    if (filter.sinceId != null) conditions.push(gt(events.id, filter.sinceId));
    if (filter.runId != null) conditions.push(eq(events.runId, filter.runId));

    const where =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const rows =
      where != null
        ? db.select().from(events).where(where).orderBy(asc(events.id)).all()
        : db.select().from(events).orderBy(asc(events.id)).all();

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      workItemId: r.workItemId,
      kind: r.kind as EventKind,
      payload: JSON.parse(r.payload),
      runId: r.runId,
      createdAt: r.createdAt,
    }));
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

export const eventStore = new EventStore();
