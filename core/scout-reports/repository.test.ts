import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { scoutReports } from '../db/schema.js';
import { listScoutReportsForInvestigation, persistScoutReport } from './repository.js';

const PROJECT = 'test-scout-reports-repo';
const WORK_ITEM = 'github:owner/repo#99';
const RUN_A = 'inv-run-a';
const RUN_B = 'inv-run-b';

beforeAll(() => {
  db.run(sql`CREATE TABLE IF NOT EXISTS scout_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    investigation_run_id TEXT NOT NULL,
    scout_skill TEXT NOT NULL,
    report TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  db.run(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS scout_reports_project_work_item_run_skill_uniq
        ON scout_reports (project_id, work_item_id, investigation_run_id, scout_skill)`,
  );
  db.run(
    sql`CREATE INDEX IF NOT EXISTS scout_reports_project_work_item_run_idx
        ON scout_reports (project_id, work_item_id, investigation_run_id)`,
  );
});

beforeEach(() => {
  db.delete(scoutReports).where(sql`project_id = ${PROJECT}`).run();
});

afterAll(() => {
  db.delete(scoutReports).where(sql`project_id = ${PROJECT}`).run();
});

describe('persistScoutReport', () => {
  it('saves a report retrievable by listScoutReportsForInvestigation', () => {
    persistScoutReport(PROJECT, WORK_ITEM, RUN_A, 'repo-scout', { findings: ['a'] });

    const rows = listScoutReportsForInvestigation(PROJECT, WORK_ITEM, RUN_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      investigationRunId: RUN_A,
      scoutSkill: 'repo-scout',
      report: { findings: ['a'] },
    });
  });

  it('upserts — same key written twice returns latest value', () => {
    persistScoutReport(PROJECT, WORK_ITEM, RUN_A, 'repo-scout', { findings: ['first'] });
    persistScoutReport(PROJECT, WORK_ITEM, RUN_A, 'repo-scout', { findings: ['second'] });

    const rows = listScoutReportsForInvestigation(PROJECT, WORK_ITEM, RUN_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].report).toEqual({ findings: ['second'] });
  });

  it('stores multiple scouts in the same investigation run', () => {
    persistScoutReport(PROJECT, WORK_ITEM, RUN_A, 'repo-scout', { x: 1 });
    persistScoutReport(PROJECT, WORK_ITEM, RUN_A, 'code-scout', { x: 2 });

    const rows = listScoutReportsForInvestigation(PROJECT, WORK_ITEM, RUN_A);
    expect(rows).toHaveLength(2);
    const skills = rows.map((r) => r.scoutSkill).sort();
    expect(skills).toEqual(['code-scout', 'repo-scout']);
  });
});

describe('listScoutReportsForInvestigation', () => {
  it('isolates by investigationRunId — run B does not see run A reports', () => {
    persistScoutReport(PROJECT, WORK_ITEM, RUN_A, 'repo-scout', { run: 'a' });
    persistScoutReport(PROJECT, WORK_ITEM, RUN_B, 'repo-scout', { run: 'b' });

    const rowsA = listScoutReportsForInvestigation(PROJECT, WORK_ITEM, RUN_A);
    const rowsB = listScoutReportsForInvestigation(PROJECT, WORK_ITEM, RUN_B);

    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].report).toEqual({ run: 'a' });

    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].report).toEqual({ run: 'b' });
  });

  it('returns empty array when no reports exist for given run', () => {
    const rows = listScoutReportsForInvestigation(PROJECT, WORK_ITEM, 'nonexistent-run');
    expect(rows).toEqual([]);
  });
});
