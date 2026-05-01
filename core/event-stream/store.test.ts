import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { events } from '../db/schema.js';
import { eventStore } from './store.js';

const PROJECT = 'test-event-store';

describe('eventStore.appendEvent', () => {
  beforeAll(() => {
    db.run(sql`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      work_item_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (current_timestamp)
    )`);
    db.run(
      sql`CREATE INDEX IF NOT EXISTS events_project_created_idx ON events (project_id, created_at)`,
    );
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
