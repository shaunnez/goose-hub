import { logger } from '@goose-hub/core/logger.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { getSourceForSlug } from '#shared/source.js';

export async function runQaBatch(slug: string, source?: StateSource): Promise<void> {
  logger.info('qa-batch started', { slug });
  const stateSource = source ?? (await getSourceForSlug(slug));
  if (stateSource == null) throw new Error(`Project not found: ${slug}`);

  // Cross-package boundary: slices/ is not a workspace package (rule 28a).
  const { runQaWorkflow } = (await import(
    new URL('../../../../../slices/qa/workflow.js', import.meta.url).href
  )) as {
    runQaWorkflow: (
      item: WorkItem,
      source: StateSource,
      projectId: string,
      repo: string,
    ) => Promise<void>;
  };

  const allItems = await stateSource.listOpenWork();
  const qaItems = allItems.filter((item) => item.state === 'factory:needs-qa');
  logger.info('qa-batch items', { slug, count: qaItems.length });

  for (const item of qaItems) {
    await runQaWorkflow(item, stateSource, stateSource.projectId, item.repoRef ?? slug);
  }
  logger.info('qa-batch finished', { slug, processed: qaItems.length });
}
