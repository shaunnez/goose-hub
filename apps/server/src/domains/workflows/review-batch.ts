import { logger } from '@goose-hub/core/logger.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { runReviewWorkflow } from '../../../../slices/review/workflow.js';
import { getSourceForSlug } from '../../shared/source.js';

export async function runReviewBatch(slug: string, source?: StateSource): Promise<void> {
  logger.info('review-batch started', { slug });
  const stateSource = source ?? (await getSourceForSlug(slug));
  if (stateSource == null) throw new Error(`Project not found: ${slug}`);

  const allItems = await stateSource.listOpenWork();
  const reviewItems = allItems.filter((item) => item.state === 'factory:needs-review');
  logger.info('review-batch items', { slug, count: reviewItems.length });

  for (const item of reviewItems) {
    await runReviewWorkflow(item, stateSource, stateSource.projectId, item.repoRef ?? slug);
  }
  logger.info('review-batch finished', { slug, processed: reviewItems.length });
}
