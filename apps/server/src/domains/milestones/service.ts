import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { runSprintReviewWorkflow } from '@goose-hub/core/workflows/sprint-review.js';
import type { Result } from '#shared/middleware.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import { checkSprintReviewEligibility } from '../workflows/sprint-review-eligibility.js';
import { readActiveMilestone, writeActiveMilestone } from './repository.js';

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

const MILESTONE_TITLE_VALID_RE = /^M\d+:\s+\S/;

export async function createMilestone(
  slug: string,
  title: string,
): Promise<Result<{ milestone: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  if (!MILESTONE_TITLE_VALID_RE.test(title)) {
    return { ok: false, error: 'title must match M<N>: <name> format', status: 422 };
  }
  const milestone = await source.createMilestone(title);
  return { ok: true, data: { milestone } };
}

export async function updateMilestone(
  slug: string,
  number: number,
  patch: { title?: string; state?: 'open' | 'closed' },
): Promise<Result<{ milestone: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  if (patch.title != null && !MILESTONE_TITLE_VALID_RE.test(patch.title)) {
    return { ok: false, error: 'title must match M<N>: <name> format', status: 422 };
  }
  // Note: renaming invalidates configMilestoneCache in resolve-milestone.ts (process-lifetime cache).
  // If project.config.ts still references the old title, resolution falls back to GitHub default
  // until server restart. This is pre-existing file-managed config behavior.
  const milestone = await source.updateMilestone(number, patch);
  return { ok: true, data: { milestone } };
}

export async function deleteMilestone(slug: string, number: number): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const milestones = await source.listMilestones();
  const target = milestones.find((m) => m.number === number);
  if (target == null) return { ok: false, error: 'milestone not found', status: 404 };

  if (target.openIssues + target.closedIssues > 0) {
    return { ok: false, error: 'milestone has issues', status: 409 };
  }

  const activeMilestone = await readActiveMilestone(slug);
  if (activeMilestone === number) {
    return {
      ok: false,
      error: 'milestone is currently active; switch away before deleting',
      status: 409,
    };
  }

  await source.deleteMilestone(number);
  return { ok: true, data: { ok: true } };
}

export async function getSprintReviewEligibility(
  slug: string,
  milestoneNumber: number,
): Promise<Result<{ eligible: boolean; reason: string; alreadyExists: boolean }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const milestones = await source.listMilestones();
  const milestone = milestones.find((m) => m.number === milestoneNumber);
  if (milestone == null) return { ok: false, error: 'milestone not found', status: 404 };

  const eligibility = await checkSprintReviewEligibility(source, milestoneNumber, milestone.title);
  return { ok: true, data: eligibility };
}

export async function triggerSprintReview(
  slug: string,
  milestoneTitle: string,
): Promise<Result<{ issueNumber: number; issueUrl: string }>> {
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

  const repoRef = allItems[0]?.repoRef;
  const result = await runSprintReviewWorkflow({
    projectId: slug,
    milestoneTitle,
    milestoneNumber: milestone.number,
    stateSource: source,
  });

  const issueUrl =
    repoRef != null
      ? `https://github.com/${repoRef}/issues/${result.issueNumber}`
      : `https://github.com/issues/${result.issueNumber}`;
  return { ok: true, data: { issueNumber: result.issueNumber, issueUrl } };
}
