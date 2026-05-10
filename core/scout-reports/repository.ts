import { and, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { scoutReports } from '../db/schema.js';
import type { ScoutReport } from './types.js';

export function persistScoutReport(
  projectId: string,
  workItemId: string,
  investigationRunId: string,
  scoutSkill: string,
  report: unknown,
): void {
  db.insert(scoutReports)
    .values({
      projectId,
      workItemId,
      investigationRunId,
      scoutSkill,
      report: JSON.stringify(report),
    })
    .onConflictDoUpdate({
      target: [
        scoutReports.projectId,
        scoutReports.workItemId,
        scoutReports.investigationRunId,
        scoutReports.scoutSkill,
      ],
      set: { report: JSON.stringify(report) },
    })
    .run();
}

export function listScoutReportsForInvestigation(
  projectId: string,
  workItemId: string,
  investigationRunId: string,
): ScoutReport[] {
  const rows = db
    .select()
    .from(scoutReports)
    .where(
      and(
        eq(scoutReports.projectId, projectId),
        eq(scoutReports.workItemId, workItemId),
        eq(scoutReports.investigationRunId, investigationRunId),
      ),
    )
    .all();

  return rows.map((r) => ({
    ...r,
    report: JSON.parse(r.report) as unknown,
  }));
}
