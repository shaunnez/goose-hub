import { db } from '@goose-hub/core/db/db.js';
import { projectState } from '@goose-hub/core/db/schema.js';
import { logger } from '@goose-hub/core/logger.js';
import type { WorkItemType } from '@goose-hub/core/state-source/interface.js';
import { eq } from 'drizzle-orm';
import { dispatchTriageBatch } from '#shared/dispatch.js';
import type { Result } from '#shared/middleware.js';
import { getSourceForSlug } from '#shared/source.js';
import { runBugEnhance } from './enhance.js';
import {
  type InboxItem,
  getInboxItem,
  insertInboxItem,
  listInboxItems,
  deleteInboxItem as repoDeleteInboxItem,
} from './repository.js';

const VALID_TYPES = ['feature', 'bug', 'chore', 'research'] as const;

function isValidPromotionType(type: string | null | undefined): type is WorkItemType {
  return VALID_TYPES.includes(type as WorkItemType);
}

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
  enhance = false,
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

  let body = item.body ?? '';
  if (enhance) {
    if (!isValidPromotionType(item.type)) {
      return { ok: false, error: 'invalid promotion type', status: 400 };
    }

    const enhancement = await runBugEnhance(source.projectId, item.id, item.title, body, item.type);
    if (enhancement != null) {
      body = `${body}\n\n---\n\n${enhancement}`;
    } else {
      logger.warn('bug-enhance: no enhancement produced, using original body', {
        id,
        type: item.type,
      });
    }
  }

  await source.createIssue({
    title: item.title,
    body,
    type: item.type as WorkItemType,
    ...(effectiveMilestoneNumber != null ? { milestoneId: String(effectiveMilestoneNumber) } : {}),
  });
  void dispatchTriageBatch(projectSlug);

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
