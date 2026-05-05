import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type {
  RetrospectivePolicy,
  TriggerContext,
} from '@goose-hub/core/workflows/retrospective.js';
import { runRetrospectiveWorkflow } from '@goose-hub/core/workflows/retrospective.js';
import { getProject } from '#shared/projects.js';
import { getSourceForSlug } from '#shared/source.js';

function resolvePolicy(defaultTier: 'light' | 'deep' | undefined): RetrospectivePolicy {
  // `defaultTier: 'deep'` means run deep unconditionally. `light` (or unset)
  // means allow auto-escalation via triggers, falling back to light otherwise.
  return defaultTier === 'deep' ? 'always-deep' : 'auto';
}

function computeTriggers(slug: string, workItem: WorkItem): TriggerContext {
  const events = eventStore.replay({ projectId: slug, workItemId: workItem.id });
  const qaFailed = events.some(
    (e) =>
      e.kind === 'qa.completed' && (e.payload as { verdict?: string } | null)?.verdict === 'fail',
  );
  // firstRunInMilestone, qualityScoreDeclining, humanRequested are deferred
  // (v1). The workflow treats undefined as falsy in selectTier.
  return { qaFailed };
}

export async function runRetroForItem(
  workItem: WorkItem,
  stateSource: StateSource,
  slug: string,
): Promise<void> {
  const cfg = await getProject(slug);
  const policy = resolvePolicy(cfg?.agentConfig.retrospectivePolicy.defaultTier);
  const triggers = computeTriggers(slug, workItem);
  await runRetrospectiveWorkflow({
    workItem,
    stateSource,
    projectId: slug,
    policy,
    triggers,
  });
}

export async function runRetroBatch(slug: string, source?: StateSource): Promise<void> {
  logger.info('retro-batch started', { slug });
  const stateSource = source ?? (await getSourceForSlug(slug));
  if (stateSource == null) throw new Error(`Project not found: ${slug}`);

  const allItems = await stateSource.listOpenWork();
  const retroItems = allItems.filter((item) => item.state === 'factory:retrospecting');
  logger.info('retro-batch items', { slug, count: retroItems.length });

  for (const item of retroItems) {
    await runRetroForItem(item, stateSource, slug);
  }
  logger.info('retro-batch finished', { slug, processed: retroItems.length });
}
