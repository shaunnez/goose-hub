import type { MilestoneDto, SprintReviewEligibility } from '../types.js';
import { deleteRequest, getJson, patchJson, postJson } from './client.js';

export async function fetchMilestones(slug: string, signal?: AbortSignal): Promise<MilestoneDto[]> {
  const { milestones } = await getJson<{ milestones: MilestoneDto[] }>(
    `/projects/${slug}/milestones`,
    signal,
  );
  return milestones;
}

export async function fetchActiveMilestone(
  slug: string,
  signal?: AbortSignal,
): Promise<{ milestoneNumber: number | null; source: string }> {
  return getJson<{ milestoneNumber: number | null; source: string }>(
    `/projects/${slug}/active-milestone`,
    signal,
  );
}

export async function setActiveMilestone(
  slug: string,
  milestoneNumber: number | null,
): Promise<void> {
  await postJson(`/projects/${slug}/active-milestone`, { milestoneNumber });
}

export async function createMilestone(slug: string, title: string): Promise<MilestoneDto> {
  const { milestone } = await postJson<{ milestone: MilestoneDto }>(
    `/projects/${slug}/milestones`,
    { title },
  );
  return milestone;
}

export async function updateMilestone(
  slug: string,
  number: number,
  patch: { title?: string; state?: 'open' | 'closed' },
): Promise<MilestoneDto> {
  const { milestone } = await patchJson<{ milestone: MilestoneDto }>(
    `/projects/${slug}/milestones/${number}`,
    patch,
  );
  return milestone;
}

export async function deleteMilestone(slug: string, number: number): Promise<void> {
  await deleteRequest(`/projects/${slug}/milestones/${number}`);
}

export async function fetchSprintReviewEligibility(
  slug: string,
  number: number,
): Promise<SprintReviewEligibility> {
  return getJson<SprintReviewEligibility>(
    `/projects/${slug}/milestones/${number}/sprint-review-eligibility`,
  );
}

export async function triggerSprintReview(
  slug: string,
  milestoneTitle: string,
): Promise<{ issueNumber: number; issueUrl: string }> {
  return postJson<{ issueNumber: number; issueUrl: string }>(
    `/projects/${slug}/milestones/${encodeURIComponent(milestoneTitle)}/sprint-review`,
    {},
  );
}
