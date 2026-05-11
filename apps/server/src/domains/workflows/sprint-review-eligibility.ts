import { TERMINAL_STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';

export interface SprintReviewEligibility {
  eligible: boolean;
  reason: string;
  alreadyExists: boolean;
  existingIssueUrl?: string;
}

export async function checkSprintReviewEligibility(
  stateSource: StateSource,
  milestoneNumber: number,
  milestoneTitle: string,
): Promise<SprintReviewEligibility> {
  const allItems = await stateSource.listWorkByMilestone(milestoneNumber);
  const currentItems = allItems.filter((item) => item.schedule === 'current');
  const sprintReviewTitle = `Sprint Review: ${milestoneTitle}`;
  const existingReviewItem = allItems.find((item) => item.title === sprintReviewTitle);
  const alreadyExists = existingReviewItem != null;
  const existingIssueUrl =
    existingReviewItem != null
      ? `https://github.com/${existingReviewItem.repoRef}/issues/${existingReviewItem.externalId}`
      : undefined;

  if (currentItems.length === 0) {
    return {
      eligible: false,
      reason: 'No schedule:current issues in milestone',
      alreadyExists,
      existingIssueUrl,
    };
  }

  const openCurrentItems = currentItems.filter((item) => !TERMINAL_STATES.has(item.state));
  if (openCurrentItems.length > 0) {
    return {
      eligible: false,
      reason: `${openCurrentItems.length} schedule:current issue(s) not yet terminal`,
      alreadyExists,
      existingIssueUrl,
    };
  }

  return { eligible: true, reason: '', alreadyExists, existingIssueUrl };
}
