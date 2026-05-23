import { storeArtifact } from '@goose-hub/core/agent-artifacts/repository.js';
import { runBugEnhance } from '@goose-hub/core/agent-runtime/bug-enhance-runner.js';
import { groundedHintsToSeed } from '@goose-hub/core/agent-runtime/scout-prefetch.js';
import { db } from '@goose-hub/core/db/db.js';
import { projectState } from '@goose-hub/core/db/schema.js';
import { logger } from '@goose-hub/core/logger.js';
import type { GroundedHints } from '@goose-hub/skills/bug-enhance/schema.js';
import { eq } from 'drizzle-orm';
import { dispatchTriageBatch } from '#shared/dispatch.js';
import type { Result } from '#shared/middleware.js';
import { getSourceForSlug } from '#shared/source.js';
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
  let groundedHints: GroundedHints | null = null;
  if (enhance && item.type === 'bug') {
    const enhancement = await runBugEnhance({
      projectId: source.projectId,
      workItemId: `inbox:${item.id}`,
      title: item.title,
      body,
    });
    if (enhancement.markdown != null) {
      body = `${body}\n\n---\n\n${enhancement.markdown}`;
    } else {
      logger.warn('bug-enhance: no enhancement produced, using original body', { id });
    }
    groundedHints = enhancement.groundedHints;
  }

  const workItem = await source.createIssue({
    title: item.title,
    body,
    type: item.type as 'feature' | 'bug' | 'chore' | 'research',
    ...(effectiveMilestoneNumber != null ? { milestoneId: String(effectiveMilestoneNumber) } : {}),
  });
  if (groundedHints != null && workItem != null) {
    persistGroundedSeed(source.projectId, workItem.id, item.id, groundedHints);
  }
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

/**
 * Persists bug-enhance's grounded hints as an `investigation-seed`
 * artifact keyed under the newly created GitHub work-item id. Lets the
 * downstream investigation/dev runs start anchored to real files instead
 * of brute-search — see `core/agent-runtime/scout-prefetch.ts`.
 */
function persistGroundedSeed(
  projectId: string,
  workItemId: string,
  inboxItemId: number,
  hints: GroundedHints,
): void {
  try {
    const seed = groundedHintsToSeed({
      candidateFiles: hints.candidateFiles,
      candidateComponents: hints.candidateComponents,
    });
    storeArtifact({
      projectId,
      workItemId,
      runId: `bug-enhance:inbox:${inboxItemId}`,
      kind: 'investigation-seed',
      artifactKey: `investigation-seed:promotion:${workItemId}`,
      summary: `Grounded seed for ${workItemId} (bug-enhance, inbox #${inboxItemId})`,
      payload: seed,
    });
  } catch (err) {
    logger.warn('inbox promotion: failed to persist grounded seed', {
      workItemId,
      err: String(err),
    });
  }
}

export async function deleteInboxItem(id: number): Promise<Result<{ ok: true }>> {
  const item = await getInboxItem(id);
  if (item == null) return { ok: false, error: 'not found', status: 404 };
  await repoDeleteInboxItem(id);
  return { ok: true, data: { ok: true } };
}
