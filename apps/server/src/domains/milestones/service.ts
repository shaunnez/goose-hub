import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { runSprintReviewWorkflow } from '@goose-hub/core/workflows/sprint-review.js';
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

export async function triggerSprintReview(
  slug: string,
  milestoneTitle: string,
): Promise<Result<{ issueNumber: number }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  // Find the milestone by title to get its number
  const milestones = await source.listMilestones();
  const milestone = milestones.find((m) => m.title === milestoneTitle);
  if (milestone == null) {
    return { ok: false, error: `milestone not found: ${milestoneTitle}`, status: 404 };
  }

  // Dedup: check if a sprint-review issue already exists
  const allItems = await source.listWorkByMilestone(milestone.number);
  const sprintReviewTitle = `Sprint Review: ${milestoneTitle}`;
  const alreadyExists = allItems.some((item) => item.title === sprintReviewTitle);
  if (alreadyExists) {
    return {
      ok: false,
      error: 'sprint-review issue already exists for this milestone',
      status: 409,
    };
  }

  const result = await runSprintReviewWorkflow({
    projectId: slug,
    milestoneTitle,
    milestoneNumber: milestone.number,
    stateSource: source,
  });

  return { ok: true, data: { issueNumber: result.issueNumber } };
}
