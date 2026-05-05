import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { events, governanceAudit, personaNames, projectState } from './schema.js';

describe('core/db smoke', () => {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema: { events, governanceAudit, personaNames, projectState } });

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
        run_id TEXT,
        persona_id TEXT,
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

      CREATE TABLE IF NOT EXISTS persona_names (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        slot_index INTEGER NOT NULL,
        codename TEXT NOT NULL,
        UNIQUE (project_id, role, slot_index)
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

  it('events row stores personaId', () => {
    db.insert(events)
      .values({
        projectId: 'test-project',
        kind: 'agent.run-started',
        payload: '{}',
        personaId: 'test-project/developer/0',
      })
      .run();
    const rows = db.select().from(events).where(eq(events.kind, 'agent.run-started')).all();
    expect(rows[0].personaId).toBe('test-project/developer/0');
  });

  it('persona_names table stores codename by slot', () => {
    db.insert(personaNames)
      .values({
        projectId: 'test-project',
        role: 'developer',
        slotIndex: 0,
        codename: 'Grey Honker',
      })
      .run();
    const rows = db
      .select()
      .from(personaNames)
      .where(eq(personaNames.projectId, 'test-project'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].codename).toBe('Grey Honker');
    expect(rows[0].slotIndex).toBe(0);
  });
});

describe('drizzle migrations', () => {
  it('__drizzle_migrations table exists after migrate runs against a fresh DB', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    const migrationsFolder = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'migrations',
    );
    migrate(db, { migrationsFolder });

    const trackingRows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
      .all();
    expect(trackingRows).toHaveLength(1);

    const tableRows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='persona_names'")
      .all();
    expect(tableRows).toHaveLength(1);
  });
});
