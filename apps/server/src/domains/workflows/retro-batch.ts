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
  const itemEvents = eventStore.replay({ projectId: slug, workItemId: workItem.id });

  const qaFailed = itemEvents.some(
    (e) =>
      e.kind === 'qa.completed' && (e.payload as { verdict?: string } | null)?.verdict === 'fail',
  );

  const humanRequested = itemEvents.some((e) => e.kind === 'gate.awaiting-human');

  const retriesGe2 = itemEvents.filter((e) => e.kind === 'agent.retry-escalated').length >= 2;

  const priorityHigh = workItem.priority === 'high' || workItem.priority === 'critical';

  const projectEvents = eventStore.replay({ projectId: slug });

  const budgetExceeded = projectEvents.some((e) => e.kind === 'project.budget-exceeded');

  const firstRunInMilestone = !projectEvents.some((e) => e.kind === 'retrospective.completed');

  return { qaFailed, humanRequested, retriesGe2, priorityHigh, budgetExceeded, firstRunInMilestone };
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
