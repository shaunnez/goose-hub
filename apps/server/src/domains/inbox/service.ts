import { db } from '@goose-hub/core/db/db.js';
import { projectState } from '@goose-hub/core/db/schema.js';
import { logger } from '@goose-hub/core/logger.js';
import { eq } from 'drizzle-orm';
import type { Result } from '../../shared/middleware.js';
import { getSourceForSlug } from '../../shared/source.js';
import {
  type InboxItem,
  getInboxItem,
  insertInboxItem,
  listInboxItems,
  deleteInboxItem as repoDeleteInboxItem,
} from './repository.js';

const VALID_TYPES = ['feature', 'bug', 'chore', 'research'] as const;

export async function createInboxItem(
  title: string | undefined,
  body: string | undefined,
  type: string | undefined,
): Promise<Result<{ item: InboxItem }>> {
  if (!title?.trim()) return { ok: false, error: 'title is required', status: 400 };
  const safeType = VALID_TYPES.includes(type as never) ? (type as string) : 'feature';
  const item = await insertInboxItem({ title: title.trim(), body: body ?? '', type: safeType });
  return { ok: true, data: { item } };
}

export async function getInboxItems(): Promise<Result<{ items: InboxItem[] }>> {
  const items = await listInboxItems();
  return { ok: true, data: { items } };
}

export async function promoteInboxItem(
  id: number,
  projectSlug: string,
  milestoneNumber?: number | null,
): Promise<Result<{ ok: true }>> {
  const item = await getInboxItem(id);
  if (item == null) return { ok: false, error: 'not found', status: 404 };

  const source = await getSourceForSlug(projectSlug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  // Use explicit milestone from caller; fall back to project's persisted active milestone
  let effectiveMilestoneNumber: number | null;
  if (milestoneNumber !== undefined) {
    effectiveMilestoneNumber = milestoneNumber;
  } else {
    const stateRows = db
      .select()
      .from(projectState)
      .where(eq(projectState.projectId, source.projectId))
      .all();
    effectiveMilestoneNumber = stateRows[0]?.activeMilestoneNumber ?? null;
  }

  await source.createIssue({
    title: item.title,
    body: item.body ?? '',
    type: item.type as 'feature' | 'bug' | 'chore' | 'research',
    ...(effectiveMilestoneNumber != null ? { milestoneId: String(effectiveMilestoneNumber) } : {}),
  });

  try {
    await repoDeleteInboxItem(id);
  } catch (err) {
    logger.error('inbox promotion: GitHub issue created but inbox delete failed', {
      id,
      err: String(err),
    });
  }

  return { ok: true, data: { ok: true } };
}

export async function deleteInboxItem(id: number): Promise<Result<{ ok: true }>> {
  const item = await getInboxItem(id);
  if (item == null) return { ok: false, error: 'not found', status: 404 };
  await repoDeleteInboxItem(id);
  return { ok: true, data: { ok: true } };
}
