import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { Result } from '#shared/middleware.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import { writeActiveMilestone } from './repository.js';

export async function getActiveMilestone(
  slug: string,
): Promise<Result<{ milestoneNumber: number | null; source: string }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const resolved = await resolveActiveMilestone(slug);
  return { ok: true, data: resolved };
}

export async function setActiveMilestone(
  slug: string,
  milestoneNumber: number | null,
): Promise<Result<{ ok: true; milestoneNumber: number | null }>> {
  // Project-existence guard — mirror getActiveMilestone (#196). Without this,
  // any caller could persist project_state rows and emit milestone.activated
  // events for non-existent slugs.
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  await writeActiveMilestone(slug, milestoneNumber, 'ui');
  eventStore.appendEvent({
    projectId: slug,
    kind: 'milestone.activated',
    payload: { milestoneNumber },
  });
  return { ok: true, data: { ok: true, milestoneNumber } };
}

const MILESTONE_TITLE_RE = /^M(\d+)/;

function extractMilestoneOrder(title: string): number {
  const m = MILESTONE_TITLE_RE.exec(title);
  return m != null ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export async function listMilestones(slug: string): Promise<Result<{ milestones: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const raw = await source.listMilestones();
  const milestones = (raw as Array<{ title: string }>)
    .filter((m) => MILESTONE_TITLE_RE.test(m.title))
    .sort((a, b) => extractMilestoneOrder(a.title) - extractMilestoneOrder(b.title));
  return { ok: true, data: { milestones } };
}

export async function listMilestoneIssues(
  slug: string,
  milestone: number,
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await source.listWorkByMilestone(milestone);
  return { ok: true, data: { items } };
}

export async function listClosedMilestoneIssues(
  slug: string,
  milestone: number,
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await source.listClosedWorkByMilestone(milestone);
  return { ok: true, data: { items } };
}
