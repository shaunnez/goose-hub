import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db.js';
import { events } from '../db/schema.js';
import { type AgentEvent, eventStore } from './store.js';

const PROJECT = 'test-event-store';

describe('eventStore.appendEvent', () => {
  beforeAll(() => {
    db.run(sql`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      work_item_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      run_id TEXT,
      created_at TEXT NOT NULL DEFAULT (current_timestamp)
    )`);
    db.run(
      sql`CREATE INDEX IF NOT EXISTS events_project_created_idx ON events (project_id, created_at)`,
    );
    // Migrate existing DBs that pre-date the run_id column
    try {
      db.run(sql`ALTER TABLE events ADD COLUMN run_id TEXT`);
    } catch {
      /* already exists */
    }
    db.delete(events).where(sql`project_id = ${PROJECT}`).run();
  });

  afterAll(() => {
    db.delete(events).where(sql`project_id = ${PROJECT}`).run();
  });

  it('writes to SQLite and emits to subscribers in that order', () => {
    const received: number[] = [];
    const unsub = eventStore.subscribe((e) => {
      if (e.projectId === PROJECT) received.push(e.id);
    });
    const written = eventStore.appendEvent({
      projectId: PROJECT,
      workItemId: 'github:foo/bar#1',
      kind: 'state.transitioned',
      payload: { from: 'factory:triaging', to: 'factory:accepted' },
    });

    expect(written.id).toBeGreaterThan(0);
    expect(received).toContain(written.id);

    const replay = eventStore.replay({ projectId: PROJECT });
    expect(replay.length).toBe(1);
    expect(replay[0].kind).toBe('state.transitioned');
    expect(replay[0].payload).toEqual({ from: 'factory:triaging', to: 'factory:accepted' });

    unsub();
  });

  it('replay supports sinceId for Last-Event-ID resumption', () => {
    const a = eventStore.appendEvent({
      projectId: PROJECT,
      kind: 'system.note',
      payload: { n: 'a' },
    });
    const b = eventStore.appendEvent({
      projectId: PROJECT,
      kind: 'system.note',
      payload: { n: 'b' },
    });
    const c = eventStore.appendEvent({
      projectId: PROJECT,
      kind: 'system.note',
      payload: { n: 'c' },
    });

    const after = eventStore.replay({ projectId: PROJECT, sinceId: a.id });
    const ids = after.map((e) => e.id);
    expect(ids).toContain(b.id);
    expect(ids).toContain(c.id);
    expect(ids).not.toContain(a.id);
  });
});

// ---------------------------------------------------------------------------
// Subscriber edge cases
// ---------------------------------------------------------------------------

describe('EventStore — subscriber edge cases', () => {
  const SUB_PROJECT = 'test-event-store-sub';

  beforeAll(() => {
    db.delete(events).where(sql`project_id = ${SUB_PROJECT}`).run();
  });

  afterEach(() => {
    db.delete(events).where(sql`project_id = ${SUB_PROJECT}`).run();
  });

  afterAll(() => {
    db.delete(events).where(sql`project_id = ${SUB_PROJECT}`).run();
  });

  it('delivers events to multiple concurrent subscribers', () => {
    const received1: AgentEvent[] = [];
    const received2: AgentEvent[] = [];

    const unsub1 = eventStore.subscribe((e) => received1.push(e));
    const unsub2 = eventStore.subscribe((e) => received2.push(e));

    eventStore.appendEvent({
      projectId: SUB_PROJECT,
      kind: 'system.note',
      payload: { msg: 'multi-subscriber test' },
    });

    unsub1();
    unsub2();

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    expect(received1[0].id).toBe(received2[0].id);
  });

  it('unsubscribe prevents further delivery', () => {
    const received: AgentEvent[] = [];
    const unsub = eventStore.subscribe((e) => {
      if (e.projectId === SUB_PROJECT) received.push(e);
    });

    eventStore.appendEvent({ projectId: SUB_PROJECT, kind: 'system.note', payload: {} });
    unsub();
    eventStore.appendEvent({ projectId: SUB_PROJECT, kind: 'system.note', payload: {} });

    expect(received).toHaveLength(1);
  });

  it('swallows errors from a broken subscriber and keeps delivering to others (#220)', () => {
    const received: AgentEvent[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* silence */
    });

    const unsubBad = eventStore.subscribe(() => {
      throw new Error('subscriber error: do not propagate');
    });
    const unsubGood = eventStore.subscribe((e) => {
      if (e.projectId === SUB_PROJECT) received.push(e);
    });

    eventStore.appendEvent({ projectId: SUB_PROJECT, kind: 'system.note', payload: { n: 1 } });

    expect(received).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();

    unsubBad();
    unsubGood();
    errorSpy.mockRestore();
  });

  it('does not propagate subscriber errors to the producing run (#220)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* silence */
    });

    const unsub = eventStore.subscribe(() => {
      throw new Error('boom');
    });

    expect(() => {
      eventStore.appendEvent({ projectId: SUB_PROJECT, kind: 'system.note', payload: {} });
    }).not.toThrow();

    unsub();
    errorSpy.mockRestore();
  });

  it('logs once per error-shape (no log spam from a persistently broken subscriber) (#220)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* silence */
    });

    const unsub = eventStore.subscribe(() => {
      throw new Error('repeating boom');
    });

    for (let i = 0; i < 5; i += 1) {
      eventStore.appendEvent({
        projectId: SUB_PROJECT,
        kind: 'system.note',
        payload: { n: i },
      });
    }

    // Error shape ('Error: repeating boom') should be logged exactly once.
    const matchingCalls = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes('repeating boom'),
    );
    expect(matchingCalls).toHaveLength(1);

    unsub();
    errorSpy.mockRestore();
  });

  it('replay returns empty array when no events match filter', () => {
    const result = eventStore.replay({ projectId: 'nonexistent-project-xyz-999' });
    expect(result).toEqual([]);
  });

  it('replay with sinceId returns only events after that id', () => {
    const SINCE_PROJECT = 'test-event-store-since';
    db.delete(events).where(sql`project_id = ${SINCE_PROJECT}`).run();

    const e1 = eventStore.appendEvent({
      projectId: SINCE_PROJECT,
      kind: 'system.note',
      payload: { n: 1 },
    });
    const e2 = eventStore.appendEvent({
      projectId: SINCE_PROJECT,
      kind: 'system.note',
      payload: { n: 2 },
    });

    const result = eventStore.replay({ projectId: SINCE_PROJECT, sinceId: e1.id });
    expect(result.map((e) => e.id)).toContain(e2.id);
    expect(result.map((e) => e.id)).not.toContain(e1.id);

    db.delete(events).where(sql`project_id = ${SINCE_PROJECT}`).run();
  });
});

// ---------------------------------------------------------------------------
// M4 runtime event kinds + runId field
// ---------------------------------------------------------------------------

describe('EventStore — M4 runtime events', () => {
  const RUN_PROJECT = 'test-event-store-m4';

  beforeAll(() => {
    db.delete(events).where(sql`project_id = ${RUN_PROJECT}`).run();
  });

  afterAll(() => {
    db.delete(events).where(sql`project_id = ${RUN_PROJECT}`).run();
  });

  it('accepts all M4 runtime event kinds', () => {
    const kinds = [
      'agent.run-started',
      'agent.run-completed',
      'agent.run-failed',
      'agent.tool-call',
      'tool.stdout-truncated',
      'tool.timeout',
      'agent.fallback-triggered',
    ] as const;
    for (const kind of kinds) {
      const e = eventStore.appendEvent({ projectId: RUN_PROJECT, kind, payload: {} });
      expect(e.kind).toBe(kind);
    }
  });

  it('accepts the three-tier QA verification event kinds (docs/standards/verification.md)', () => {
    const kinds = ['qa.structural-failed', 'qa.functional-failed', 'qa.regression-failed'] as const;
    for (const kind of kinds) {
      const e = eventStore.appendEvent({ projectId: RUN_PROJECT, kind, payload: {} });
      expect(e.kind).toBe(kind);
    }
  });

  it('stores and retrieves runId on events', () => {
    const runId = 'run-test-abc123';
    const e = eventStore.appendEvent({
      projectId: RUN_PROJECT,
      kind: 'agent.run-started',
      payload: { skill: 'echo-test' },
      runId,
    });
    expect(e.runId).toBe(runId);
  });

  it('replay filters by runId', () => {
    const runA = 'run-filter-a';
    const runB = 'run-filter-b';
    const FILTER_PROJECT = 'test-event-store-runid';
    db.delete(events).where(sql`project_id = ${FILTER_PROJECT}`).run();

    eventStore.appendEvent({
      projectId: FILTER_PROJECT,
      kind: 'agent.run-started',
      payload: {},
      runId: runA,
    });
    eventStore.appendEvent({
      projectId: FILTER_PROJECT,
      kind: 'agent.run-started',
      payload: {},
      runId: runB,
    });

    const results = eventStore.replay({ projectId: FILTER_PROJECT, runId: runA });
    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe(runA);

    db.delete(events).where(sql`project_id = ${FILTER_PROJECT}`).run();
  });

  it('redacts secrets in payload before persisting', () => {
    const e = eventStore.appendEvent({
      projectId: RUN_PROJECT,
      kind: 'agent.tool-call',
      payload: { token: 'AKIAIOSFODNN7EXAMPLE' },
      runId: 'run-redact-test',
    });
    const p = e.payload as { token: string };
    expect(p.token).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// replay branch coverage — zero conditions, single workItemId, multi-condition
// ---------------------------------------------------------------------------

describe('EventStore — replay branch coverage', () => {
  const BRANCH_PROJECT = 'test-event-store-branch';

  beforeAll(() => {
    db.delete(events).where(sql`project_id = ${BRANCH_PROJECT}`).run();
  });

  afterAll(() => {
    db.delete(events).where(sql`project_id = ${BRANCH_PROJECT}`).run();
  });

  it('replay with no filter (zero conditions) returns all stored events', () => {
    const before = eventStore.replay({}).length;
    const e = eventStore.appendEvent({
      projectId: BRANCH_PROJECT,
      kind: 'system.note',
      payload: { zero: true },
    });
    const after = eventStore.replay({}).length;
    // At least one more row than before
    expect(after).toBeGreaterThan(before);
    expect(eventStore.replay({}).map((ev) => ev.id)).toContain(e.id);
  });

  it('replay filtered by workItemId only (single condition path)', () => {
    const workItemId = 'github:test/repo#777';
    const e = eventStore.appendEvent({
      projectId: BRANCH_PROJECT,
      workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:triaging', to: 'factory:accepted' },
    });

    const result = eventStore.replay({ workItemId });
    expect(result.map((ev) => ev.id)).toContain(e.id);
    // All returned rows must match the workItemId
    for (const row of result) {
      expect(row.workItemId).toBe(workItemId);
    }
  });

  it('replay filtered by projectId + workItemId (two conditions → and() branch)', () => {
    const workItemId = 'github:test/repo#888';
    const eA = eventStore.appendEvent({
      projectId: BRANCH_PROJECT,
      workItemId,
      kind: 'system.note',
      payload: { n: 'a' },
    });
    // Noise: same workItemId, different project
    eventStore.appendEvent({
      projectId: 'test-event-store-branch-other',
      workItemId,
      kind: 'system.note',
      payload: { n: 'b' },
    });

    const result = eventStore.replay({ projectId: BRANCH_PROJECT, workItemId });
    const ids = result.map((ev) => ev.id);
    expect(ids).toContain(eA.id);
    // All returned rows must belong to our project
    for (const row of result) {
      expect(row.projectId).toBe(BRANCH_PROJECT);
    }
  });

  it('replay filtered by projectId + sinceId + runId (three conditions → and() branch)', () => {
    const runId = 'branch-run-999';
    const e1 = eventStore.appendEvent({
      projectId: BRANCH_PROJECT,
      kind: 'agent.run-started',
      payload: {},
      runId,
    });
    const e2 = eventStore.appendEvent({
      projectId: BRANCH_PROJECT,
      kind: 'agent.run-completed',
      payload: {},
      runId,
    });

    const result = eventStore.replay({
      projectId: BRANCH_PROJECT,
      sinceId: e1.id,
      runId,
    });
    expect(result.map((ev) => ev.id)).toContain(e2.id);
    expect(result.map((ev) => ev.id)).not.toContain(e1.id);
  });

  it('subscribe: logs with <no message> when thrown error has no message property', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const unsub = eventStore.subscribe(() => {
      // Throw a plain object that has no .name or .message
      // biome-ignore lint/suspicious/noExplicitAny: intentional for branch coverage
      throw { code: 'CUSTOM_ERROR' } as any;
    });

    eventStore.appendEvent({
      projectId: BRANCH_PROJECT,
      kind: 'system.note',
      payload: { branch: 'no-message' },
    });

    // The error shape should include 'Error' (fallback name) and '<no message>'
    const call = errorSpy.mock.calls.find((args) => String(args[0]).includes('<no message>'));
    expect(call).toBeDefined();

    unsub();
    errorSpy.mockRestore();
  });
});
