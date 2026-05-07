import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type {
  RetrospectivePolicy,
  TriggerContext,
} from '@goose-hub/core/workflows/retrospective.js';
import { runRetrospectiveWorkflow } from '@goose-hub/core/workflows/retrospective.js';
import { runSprintReviewWorkflow } from '@goose-hub/core/workflows/sprint-review.js';
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

  // `agent.retry-escalated` is shared between workflow-level retries (qa, review)
  // and model-tier escalation (haiku→sonnet on schema failure). retriesGe2 should
  // only count workflow-level retries — a model-tier retry isn't evidence that
  // the work item is struggling.
  const retriesGe2 =
    itemEvents.filter(
      (e) =>
        e.kind === 'agent.retry-escalated' &&
        (e.payload as { stage?: string } | null)?.stage !== 'model',
    ).length >= 2;

  const priorityHigh = workItem.priority === 'high' || workItem.priority === 'critical';

  const projectEvents = eventStore.replay({ projectId: slug });

  const budgetExceeded = projectEvents.some((e) => e.kind === 'project.budget-exceeded');

  const firstRunInMilestone = !projectEvents.some((e) => e.kind === 'retrospective.completed');

  return {
    qaFailed,
    humanRequested,
    retriesGe2,
    priorityHigh,
    budgetExceeded,
    firstRunInMilestone,
  };
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

  // Auto-trigger sprint review when the last schedule:current item in the
  // milestone reaches factory:done (i.e., the retro just completed above).
  // Fire-and-forget — errors are logged but must not propagate to the caller.
  const milestoneNumber = workItem.milestoneId != null ? Number(workItem.milestoneId) : null;
  const milestoneTitle = workItem.milestoneTitle ?? null;

  if (milestoneNumber != null && !Number.isNaN(milestoneNumber) && milestoneTitle != null) {
    // Run asynchronously so we don't block the retro batch tick
    void maybeFireSprintReview(slug, stateSource, milestoneNumber, milestoneTitle);
  }
}

/**
 * Fires sprint-review if all schedule:current items in the milestone are done
 * and no sprint-review issue already exists for the milestone.
 */
async function maybeFireSprintReview(
  slug: string,
  stateSource: StateSource,
  milestoneNumber: number,
  milestoneTitle: string,
): Promise<void> {
  try {
    const allItems = await stateSource.listWorkByMilestone(milestoneNumber);

    // Check for remaining open schedule:current items
    const openCurrentItems = allItems.filter(
      (item) => item.schedule === 'current' && item.state !== 'factory:done',
    );

    if (openCurrentItems.length > 0) {
      // Some items still pending — not the last one
      return;
    }

    // Dedup: check if a sprint-review issue already exists
    const sprintReviewTitle = `Sprint Review: ${milestoneTitle}`;
    const alreadyExists = allItems.some((item) => item.title === sprintReviewTitle);
    if (alreadyExists) {
      logger.info('sprint-review: already exists, skipping', { slug, milestoneTitle });
      return;
    }

    logger.info('sprint-review: all schedule:current items done, triggering sprint review', {
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
