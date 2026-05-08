import type { StateSource } from '@goose-hub/core/state-source/interface.js';

export interface SprintReviewEligibility {
  eligible: boolean;
  reason: string;
  alreadyExists: boolean;
}

const TERMINAL_STATES = new Set(['factory:done', 'factory:archived', 'factory:rejected']);

export async function checkSprintReviewEligibility(
  stateSource: StateSource,
  milestoneNumber: number,
  milestoneTitle: string,
): Promise<SprintReviewEligibility> {
  const allItems = await stateSource.listWorkByMilestone(milestoneNumber);
  const currentItems = allItems.filter((item) => item.schedule === 'current');
  const sprintReviewTitle = `Sprint Review: ${milestoneTitle}`;
  const alreadyExists = allItems.some((item) => item.title === sprintReviewTitle);

  if (currentItems.length === 0) {
    return { eligible: false, reason: 'No schedule:current issues in milestone', alreadyExists };
  }

  const openCurrentItems = currentItems.filter((item) => !TERMINAL_STATES.has(item.state));
  if (openCurrentItems.length > 0) {
    return {
      eligible: false,
      reason: `${openCurrentItems.length} schedule:current issue(s) not yet terminal`,
      alreadyExists,
    };
  }

  return { eligible: true, reason: '', alreadyExists };
}
