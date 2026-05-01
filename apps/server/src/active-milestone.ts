import { db } from '@goose-hub/core/db/db.js';
import { projectState } from '@goose-hub/core/db/schema.js';
import { eq } from 'drizzle-orm';

export async function readActiveMilestone(projectId: string): Promise<number | null> {
  const rows = db.select().from(projectState).where(eq(projectState.projectId, projectId)).all();
  if (rows.length === 0) return null;
  return rows[0].activeMilestoneNumber;
}

export async function writeActiveMilestone(
  projectId: string,
  milestoneNumber: number | null,
  by: string,
): Promise<void> {
  const existing = db
    .select()
    .from(projectState)
    .where(eq(projectState.projectId, projectId))
    .all();
  const now = new Date().toISOString();
  if (existing.length === 0) {
    db.insert(projectState)
      .values({
        projectId,
        activeMilestoneNumber: milestoneNumber,
        activeMilestoneSetAt: now,
        activeMilestoneSetBy: by,
      })
      .run();
  } else {
    db.update(projectState)
      .set({
        activeMilestoneNumber: milestoneNumber,
        activeMilestoneSetAt: now,
        activeMilestoneSetBy: by,
      })
      .where(eq(projectState.projectId, projectId))
      .run();
  }
}
