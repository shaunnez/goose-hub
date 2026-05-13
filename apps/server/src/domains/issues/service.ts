import { getEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import {
  SCHEDULE_UI_TO_VALUE,
  type ScheduleUIValue,
} from '@goose-hub/core/state-source/github-labels.js';
import type { Result } from '#shared/middleware.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import { getLastPersonaIdsByWorkItem, getRepoRef } from './internal.js';

function buildPrdRelationships(projectId: string): {
  byParent: Map<string, string[]>;
  byChild: Map<string, string>;
} {
  const byParent = new Map<string, string[]>();
  const byChild = new Map<string, string>();
  const decomposeEvents = eventStore.replay({ projectId, kind: 'decompose.completed' });
  for (const ev of decomposeEvents) {
    if (ev.workItemId == null) continue;
    const parentExternalId = ev.workItemId.split('#').pop();
    if (parentExternalId == null) continue;
    const payload = ev.payload as { childIssueNumbers?: number[] };
    const children = (payload.childIssueNumbers ?? []).map(String);
    if (children.length === 0) continue;
    byParent.set(parentExternalId, children);
    for (const c of children) byChild.set(c, parentExternalId);
  }
  return { byParent, byChild };
}

// Public surface for the issues domain. The implementation is split across
// sibling files to keep each concern focused; this barrel re-exports the
// pieces the router and tests depend on.
export { approveIssue, rejectIssue, transitionIssue } from './transitions.js';
export type { TransitionResult } from './transitions.js';
export { getIssueWorktreeDiff } from './diff.js';
export { getIssueTriage, overrideIssueRepo } from './triage.js';
export { fakeRun } from './fake-run.js';
export { approvePRD, declinePRD, proceedToPrd, rejectPRD, revisePRD } from './prd-actions.js';

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
  const { byParent, byChild } = buildPrdRelationships(slug);
  const enriched = items.map((item) => ({
    ...(item as object),
    lastPersonaId: lastPersonaMap.get((item as { id: string }).id) ?? null,
    dependsOnTitles: Object.fromEntries(
      (item.dependsOn ?? [])
        .filter((ref) => titleByExternalId.has(ref))
        .map((ref) => [ref, titleByExternalId.get(ref) ?? '']),
    ),
    prdChildren: byParent.get(item.externalId),
    prdParent: byChild.get(item.externalId),
  }));
  return { ok: true, data: { items: enriched } };
}

export async function getIssue(slug: string, id: string): Promise<Result<{ item: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  const lastPersonaMap = getLastPersonaIdsByWorkItem(slug);
  const workItemId = (item as { id: string }).id;
  const { byParent, byChild } = buildPrdRelationships(slug);
  const externalId = (item as { externalId: string }).externalId;
  const enriched = {
    ...(item as object),
    lastPersonaId: lastPersonaMap.get(workItemId) ?? null,
    prdChildren: byParent.get(externalId),
    prdParent: byChild.get(externalId),
  };
  return { ok: true, data: { item: enriched } };
}

export async function getIssueSpec(
  slug: string,
  id: string,
): Promise<
  Result<{
    spec: {
      pipelineRunId: string;
      objective: string;
      workPackages: Array<{ id: string; filesOwned: string[]; builderTier: string }>;
      acceptanceCriteriaCount: number;
    } | null;
  }>
> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const record = getEngineeringSpec(slug, workItemId);
  if (record == null) return { ok: true, data: { spec: null } };
  return {
    ok: true,
    data: {
      spec: record.spec as {
        pipelineRunId: string;
        objective: string;
        workPackages: Array<{ id: string; filesOwned: string[]; builderTier: string }>;
        acceptanceCriteriaCount: number;
      },
    },
  };
}

export async function getIssueEvents(
  slug: string,
  id: string,
  opts?: { limit?: number; before?: number },
): Promise<Result<{ events: unknown[]; hasMore: boolean }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  if (opts?.limit != null) {
    const fetched = eventStore.replay({
      projectId: slug,
      workItemId,
      limit: opts.limit + 1,
      before: opts.before,
      order: 'desc',
    });
    const hasMore = fetched.length > opts.limit;
    return {
      ok: true,
      data: { events: hasMore ? fetched.slice(0, opts.limit) : fetched, hasMore },
    };
  }

  const ascending = eventStore.replay({ projectId: slug, workItemId });
  return { ok: true, data: { events: [...ascending].reverse(), hasMore: false } };
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
/**
 * UI-facing schedule values. The labels written to GitHub use `next`/`later`
 * (canonical Schedule), but the UI exposes `backlog`/`icebox` as friendlier
 * synonyms — `SCHEDULE_UI_TO_VALUE` translates before calling the data layer.
 */
const VALID_SCHEDULE = ['current', 'backlog', 'icebox', 'blocked-by'] as const;
const VALID_TYPE = ['feature', 'bug', 'chore', 'research'] as const;

export async function setIssueLabel(
  slug: string,
  id: string,
  group: unknown,
  value: unknown,
): Promise<Result<{ ok: true }>> {
  if (group !== 'priority' && group !== 'schedule' && group !== 'type') {
    return { ok: false, error: 'group must be priority, schedule, or type', status: 400 };
  }
  if (group === 'priority' && !VALID_PRIORITY.includes(value as never)) {
    return { ok: false, error: 'invalid priority', status: 400 };
  }
  if (group === 'schedule' && !VALID_SCHEDULE.includes(value as never)) {
    return { ok: false, error: 'invalid schedule', status: 400 };
  }
  if (group === 'type' && !VALID_TYPE.includes(value as never)) {
    return { ok: false, error: 'invalid type', status: 400 };
  }
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  // Translate UI-facing schedule synonyms (`backlog`/`icebox`) to the canonical
  // label values (`next`/`later`) before the data layer sees them. Without
  // this, the in-memory source silently no-ops and GitHub gets an invalid
  // `schedule:backlog` label name.
  const persistedValue =
    group === 'schedule' ? SCHEDULE_UI_TO_VALUE[value as ScheduleUIValue] : (value as string);
  await source.setLabelInGroup(workItemId, group, persistedValue);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: `set-${group}`, value: persistedValue },
  });
  return { ok: true, data: { ok: true } };
}
