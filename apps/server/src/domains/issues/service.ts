import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { Result } from '#shared/middleware.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import { getLastPersonaIdsByWorkItem, getRepoRef } from './internal.js';

// Public surface for the issues domain. The implementation is split across
// sibling files to keep each concern focused; this barrel re-exports the
// pieces the router and tests depend on.
export { approveIssue, rejectIssue, transitionIssue } from './transitions.js';
export type { TransitionResult } from './transitions.js';
export { getIssueWorktreeDiff } from './diff.js';
export { getIssueTriage, overrideIssueRepo } from './triage.js';
export { fakeRun } from './fake-run.js';

export async function listIssues(
  slug: string,
  opts?: { all?: boolean },
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const milestoneNumber = opts?.all
    ? undefined
    : ((await resolveActiveMilestone(slug)).milestoneNumber ?? undefined);
  const items = await source.listOpenWork(milestoneNumber);
  const lastPersonaMap = getLastPersonaIdsByWorkItem(slug);
  const titleByExternalId = new Map(items.map((i) => [i.externalId, i.title]));
  const enriched = items.map((item) => ({
    ...(item as object),
    lastPersonaId: lastPersonaMap.get((item as { id: string }).id) ?? null,
    dependsOnTitles: Object.fromEntries(
      (item.dependsOn ?? [])
        .filter((ref) => titleByExternalId.has(ref))
        .map((ref) => [ref, titleByExternalId.get(ref) ?? '']),
    ),
  }));
  return { ok: true, data: { items: enriched } };
}

export async function getIssue(slug: string, id: string): Promise<Result<{ item: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  const lastPersonaMap = getLastPersonaIdsByWorkItem(slug);
  const workItemId = (item as { id: string }).id;
  const enriched = { ...(item as object), lastPersonaId: lastPersonaMap.get(workItemId) ?? null };
  return { ok: true, data: { item: enriched } };
}

export async function getIssueEvents(
  slug: string,
  id: string,
): Promise<Result<{ events: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const ascending = eventStore.replay({ projectId: slug, workItemId });
  const events = [...ascending].reverse();
  return { ok: true, data: { events } };
}

export async function getIssueComments(
  slug: string,
  id: string,
): Promise<Result<{ comments: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const comments = await source.listComments(workItemId);
  return { ok: true, data: { comments } };
}

export async function commentOnIssue(
  slug: string,
  id: string,
  body: string | undefined,
): Promise<Result<{ ok: true }>> {
  if (!body?.trim()) return { ok: false, error: 'body is required', status: 400 };
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.comment(workItemId, body.trim());
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'comment', preview: body.trim().slice(0, 80) },
  });
  return { ok: true, data: { ok: true } };
}

export async function setIssueMilestone(
  slug: string,
  id: string,
  milestoneNumber: number | null,
): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.setMilestone(workItemId, milestoneNumber);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'set-milestone', milestoneNumber },
  });
  return { ok: true, data: { ok: true } };
}

const VALID_PRIORITY = ['low', 'medium', 'high', 'critical'] as const;
const VALID_SCHEDULE = ['current', 'backlog', 'icebox', 'blocked-by'] as const;

export async function setIssueLabel(
  slug: string,
  id: string,
  group: unknown,
  value: unknown,
): Promise<Result<{ ok: true }>> {
  if (group !== 'priority' && group !== 'schedule') {
    return { ok: false, error: 'group must be priority or schedule', status: 400 };
  }
  if (group === 'priority' && !VALID_PRIORITY.includes(value as never)) {
    return { ok: false, error: 'invalid priority', status: 400 };
  }
  if (group === 'schedule' && !VALID_SCHEDULE.includes(value as never)) {
    return { ok: false, error: 'invalid schedule', status: 400 };
  }
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.setLabelInGroup(workItemId, group, value as string);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: `set-${group}`, value },
  });
  return { ok: true, data: { ok: true } };
}
