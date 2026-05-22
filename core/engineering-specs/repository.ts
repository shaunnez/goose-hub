import { and, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { engineeringSpecs } from '../db/schema.js';
import type { EngineeringSpecRecord } from './types.js';

export function persistEngineeringSpec(
  projectId: string,
  workItemId: string,
  pipelineRunId: string,
  spec: unknown,
): void {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  db.insert(engineeringSpecs)
    .values({
      projectId,
      workItemId,
      pipelineRunId,
      spec: JSON.stringify(spec),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [engineeringSpecs.projectId, engineeringSpecs.workItemId],
      set: {
        pipelineRunId,
        spec: JSON.stringify(spec),
        updatedAt: now,
      },
    })
    .run();
}

export function getEngineeringSpec(
  projectId: string,
  workItemId: string,
): EngineeringSpecRecord | null {
  const row = db
    .select()
    .from(engineeringSpecs)
    .where(
      and(eq(engineeringSpecs.projectId, projectId), eq(engineeringSpecs.workItemId, workItemId)),
    )
    .get();

  if (!row) return null;
  return { ...row, spec: JSON.parse(row.spec) as unknown };
}

export function deleteEngineeringSpec(projectId: string, workItemId: string): void {
  db.delete(engineeringSpecs)
    .where(
      and(eq(engineeringSpecs.projectId, projectId), eq(engineeringSpecs.workItemId, workItemId)),
    )
    .run();
}
