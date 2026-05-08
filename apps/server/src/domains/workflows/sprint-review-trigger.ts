import { logger } from '@goose-hub/core/logger.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { runSprintReviewWorkflow } from '@goose-hub/core/workflows/sprint-review.js';
import { checkSprintReviewEligibility } from './sprint-review-eligibility.js';

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
    const { eligible, alreadyExists } = await checkSprintReviewEligibility(
      stateSource,
      milestoneNumber,
      milestoneTitle,
    );

    if (alreadyExists) {
      logger.info('sprint-review: already exists, skipping', { slug, milestoneTitle });
      return;
    }

    if (!eligible) {
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
