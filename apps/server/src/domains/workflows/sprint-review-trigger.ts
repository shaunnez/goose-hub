import { logger } from '@goose-hub/core/logger.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { runSprintReviewWorkflow } from '@goose-hub/core/workflows/sprint-review.js';

/** States that count as terminal for the sprint-review trigger (PLAN §12.6). */
const TERMINAL_STATES = new Set(['factory:done', 'factory:archived', 'factory:rejected']);

/**
 * Fires sprint-review if all schedule:current items in the milestone have
 * reached a terminal state (done / archived / rejected) and no sprint-review
 * issue already exists for the milestone.
 *
 * Fire-and-forget by design — callers should not await this when they don't
 * want it to block their own completion path.  Errors are logged but never
 * re-thrown.
 */
export async function maybeFireSprintReview(
  slug: string,
  milestoneNumber: number,
  milestoneTitle: string,
  stateSource: StateSource,
): Promise<void> {
  try {
    const allItems = await stateSource.listWorkByMilestone(milestoneNumber);

    const currentItems = allItems.filter((item) => item.schedule === 'current');

    // Need at least one terminal item to fire (milestone isn't empty).
    const terminalItems = currentItems.filter((item) => TERMINAL_STATES.has(item.state));
    if (terminalItems.length === 0) {
      return;
    }

    // Every schedule:current item must be terminal.
    const openCurrentItems = currentItems.filter((item) => !TERMINAL_STATES.has(item.state));
    if (openCurrentItems.length > 0) {
      return;
    }

    // Dedup: check if a sprint-review issue already exists.
    const sprintReviewTitle = `Sprint Review: ${milestoneTitle}`;
    const alreadyExists = allItems.some((item) => item.title === sprintReviewTitle);
    if (alreadyExists) {
      logger.info('sprint-review: already exists, skipping', { slug, milestoneTitle });
      return;
    }

    logger.info('sprint-review: all schedule:current items terminal, triggering sprint review', {
      slug,
      milestoneTitle,
    });

    await runSprintReviewWorkflow({
      projectId: slug,
      milestoneTitle,
      milestoneNumber,
      stateSource,
    });

    logger.info('sprint-review: completed', { slug, milestoneTitle });
  } catch (err) {
    logger.error('sprint-review: auto-trigger failed', {
      slug,
      milestoneTitle,
      error: String(err),
    });
  }
}
