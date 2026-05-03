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
  | 'agent.fallback-triggered'
  | 'agent.triage-complete'
  | 'agent.repo-override'
  | 'agent.investigation-complete'
  // Three-tier verification framework — see docs/standards/verification.md
  | 'qa.structural-failed'
  | 'qa.functional-failed'
  | 'qa.regression-failed'
  // M7 fix-issue workflow lifecycle (#183) + evidence-post wiring (#234)
  | 'agent.implement-complete'
  | 'pr.opened'
  | 'evidence.posted'
  | 'evidence.post-failed'
  | 'evidence.no-spec-declared'
  // M7 approval gate (#186)
  | 'gate.approved'
  | 'gate.rejected'
  | 'pr.merged'
  // M8 holdout enforcement — context injection boundary violations
  | 'tool.violation'
  // M8 QA/Review lifecycle events
  | 'qa.completed'
  | 'review.completed'
  // M8 retry-and-escalate
  | 'agent.retry-escalated'
  // M9 retrospective lifecycle
  | 'retrospective.completed';

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
}

export const eventStore = new EventStore();
