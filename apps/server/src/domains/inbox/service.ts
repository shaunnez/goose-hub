import { logger } from '@goose-hub/core/logger.js';
import type { Result } from '../../shared/middleware.js';
import { getSourceForSlug } from '../../shared/source.js';
import {
  type InboxItem,
  deleteInboxItem,
  getInboxItem,
  insertInboxItem,
  listInboxItems,
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
): Promise<Result<{ ok: true }>> {
  const item = await getInboxItem(id);
  if (item == null) return { ok: false, error: 'not found', status: 404 };

  const source = await getSourceForSlug(projectSlug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  await source.createIssue({
    title: item.title,
    body: item.body ?? '',
    type: item.type as 'feature' | 'bug' | 'chore' | 'research',
  });

  try {
    await deleteInboxItem(id);
  } catch (err) {
    logger.error('inbox promotion: GitHub issue created but inbox delete failed', {
      id,
      err: String(err),
    });
  }

  return { ok: true, data: { ok: true } };
}
