import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import { events, governanceAudit, projectState } from './schema.js';

describe('core/db smoke', () => {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema: { events, governanceAudit, projectState } });

  beforeAll(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS project_state (
        project_id TEXT PRIMARY KEY,
        active_milestone_number INTEGER,
        active_milestone_set_at TEXT,
        active_milestone_set_by TEXT,
        last_tick_at TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        work_item_id TEXT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (current_timestamp)
      );

      CREATE INDEX IF NOT EXISTS events_project_created_idx
        ON events (project_id, created_at);

      CREATE TABLE IF NOT EXISTS governance_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_url TEXT NOT NULL,
        project_id TEXT NOT NULL,
        ok INTEGER NOT NULL,
        violations TEXT NOT NULL,
        checked_at TEXT NOT NULL DEFAULT (current_timestamp)
      );
    `);
  });

  it('inserts and reads a project_state row', () => {
    db.insert(projectState).values({ projectId: 'test-project' }).run();
    const rows = db
      .select()
      .from(projectState)
      .where(eq(projectState.projectId, 'test-project'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBe('test-project');
  });

  it('inserts and reads an events row', () => {
    db.insert(events)
      .values({
        projectId: 'test-project',
        kind: 'agent.decision-summary',
        payload: '{"msg":"test"}',
      })
      .run();
    const rows = db.select().from(events).where(eq(events.projectId, 'test-project')).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('agent.decision-summary');
    expect(rows[0].payload).toBe('{"msg":"test"}');
  });

  it('inserts and reads a governance_audit row', () => {
    db.insert(governanceAudit)
      .values({
        prUrl: 'https://github.com/shaunnez/goose-hub/pull/4',
        projectId: 'test-project',
        ok: 1,
        violations: '[]',
      })
      .run();
    const rows = db
      .select()
      .from(governanceAudit)
      .where(eq(governanceAudit.projectId, 'test-project'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].prUrl).toBe('https://github.com/shaunnez/goose-hub/pull/4');
    expect(rows[0].ok).toBe(1);
    expect(rows[0].violations).toBe('[]');
  });
});
