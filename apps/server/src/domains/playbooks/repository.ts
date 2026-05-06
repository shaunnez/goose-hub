import { db } from '@goose-hub/core/db/db.js';
import { playbooks } from '@goose-hub/core/db/schema.js';
import { and, desc, eq } from 'drizzle-orm';

export interface PlaybookRow {
  id: number;
  projectId: string;
  windowStartAt: string;
  windowEndAt: string;
  lifecycleCount: number;
  manifest: string;
  createdAt: string;
}

export async function listPlaybooksForProject(projectId: string): Promise<PlaybookRow[]> {
  return db
    .select()
    .from(playbooks)
    .where(eq(playbooks.projectId, projectId))
    .orderBy(desc(playbooks.createdAt))
    .all();
}

export async function getPlaybookByIdForProject(
  projectId: string,
  id: number,
): Promise<PlaybookRow | null> {
  const rows = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.projectId, projectId), eq(playbooks.id, id)))
    .all();
  return rows[0] ?? null;
}
