import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { agentRuns } from '../db/schema.js';
import { recordAgentRun } from './run-record.js';

const PROJECT = 'test-run-record';

beforeEach(() => {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    work_item_id TEXT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    skill TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_run_id_uniq ON agent_runs (run_id)`);
  db.delete(agentRuns).where(eq(agentRuns.projectId, PROJECT)).run();
});

describe('recordAgentRun', () => {
  it('inserts an agent_runs row idempotently on runId', () => {
    const row = {
      runId: `run-record-${Date.now()}`,
      personaId: 'p1',
      workItemId: 'github:x#1',
      projectId: PROJECT,
      role: 'developer' as const,
      skill: 'implement-wp',
      outcome: 'success' as const,
    };

    recordAgentRun(row);
    recordAgentRun(row);

    const found = db.select().from(agentRuns).where(eq(agentRuns.runId, row.runId)).all();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      personaId: 'p1',
      outcome: 'success',
      skill: 'implement-wp',
    });
  });
});
