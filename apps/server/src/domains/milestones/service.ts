import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { CACHE_KEY, bustCache, getCached } from '../../shared/cache.js';
import type { Result } from '../../shared/middleware.js';
import { getSourceForSlug } from '../../shared/source.js';
import { readActiveMilestone, writeActiveMilestone } from './repository.js';

export async function getActiveMilestone(
  slug: string,
): Promise<Result<{ milestoneNumber: number | null; source: string }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const persisted = await readActiveMilestone(slug);
  if (persisted != null) {
    return { ok: true, data: { milestoneNumber: persisted, source: 'project_state' } };
  }
  const fallback = await source.getActiveMilestone();
  return {
    ok: true,
    data: { milestoneNumber: fallback?.number ?? null, source: 'github-default' },
  };
}

export async function setActiveMilestone(
  slug: string,
  milestoneNumber: number | null,
): Promise<Result<{ ok: true; milestoneNumber: number | null }>> {
  await writeActiveMilestone(slug, milestoneNumber, 'ui');
  bustCache(CACHE_KEY.milestones(slug));
  eventStore.appendEvent({
    projectId: slug,
    kind: 'milestone.activated',
    payload: { milestoneNumber },
  });
  return { ok: true, data: { ok: true, milestoneNumber } };
}

export async function listMilestones(slug: string): Promise<Result<{ milestones: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const milestones = await getCached(CACHE_KEY.milestones(slug), 60_000, () =>
    source.listMilestones(),
  );
  return { ok: true, data: { milestones } };
}

export async function listMilestoneIssues(
  slug: string,
  milestone: number,
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await getCached(CACHE_KEY.milestoneIssues(slug, milestone), 60_000, () =>
    source.listWorkByMilestone(milestone),
  );
  return { ok: true, data: { items } };
}

export async function listClosedMilestoneIssues(
  slug: string,
  milestone: number,
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await getCached(CACHE_KEY.closedIssues(slug, milestone), 60_000, () =>
    source.listClosedWorkByMilestone(milestone),
  );
  return { ok: true, data: { items } };
}
