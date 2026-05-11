import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type {
  RetrospectivePolicy,
  TriggerContext,
} from '@goose-hub/core/workflows/retrospective.js';
import { runRetrospectiveWorkflow } from '@goose-hub/core/workflows/retrospective.js';
import { existingWorktreePath } from '@goose-hub/core/workspaces/worktree.js';
import { getProject } from '#shared/projects.js';
import { getSourceForSlug } from '#shared/source.js';
import { maybeFireSprintReview } from './sprint-review-trigger.js';

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

/** Locate the dev worktree path for the work item's most recent `pr.opened`
 * event. M19.22 (#698) — deep retro on a priority:high lifecycle attaches an
 * audit run when a worktree is still around (cleanupWorktree fires post-
 * merge, so the worktree may already be gone for some retro runs). */
function findAuditWorktreePath(slug: string, workItemId: string): string | null {
  const events = eventStore.replay({ projectId: slug, workItemId });
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'pr.opened') continue;
    const payload = e.payload as { devRunId?: string } | null;
    if (payload?.devRunId != null && typeof payload.devRunId === 'string') {
      return existingWorktreePath(payload.devRunId);
    }
  }
  return null;
}

export async function runRetroForItem(
  workItem: WorkItem,
  stateSource: StateSource,
  slug: string,
): Promise<void> {
  const cfg = await getProject(slug);
  const policy = resolvePolicy(cfg?.agentConfig.retrospectivePolicy.defaultTier);
  const triggers = computeTriggers(slug, workItem);
  const auditWorktreePath = triggers.priorityHigh ? findAuditWorktreePath(slug, workItem.id) : null;
  await runRetrospectiveWorkflow({
    workItem,
    stateSource,
    projectId: slug,
    policy,
    triggers,
    auditWorktreePath,
  });

  // Auto-trigger sprint review when the last schedule:current item in the
  // milestone reaches a terminal state (done/archived/rejected — PLAN §12.6).
  // Fire-and-forget — errors are logged inside maybeFireSprintReview.
  const milestoneNumber = workItem.milestoneId != null ? Number(workItem.milestoneId) : null;
  const milestoneTitle = workItem.milestoneTitle ?? null;

  if (milestoneNumber != null && !Number.isNaN(milestoneNumber) && milestoneTitle != null) {
    // Run asynchronously so we don't block the retro batch tick
    void maybeFireSprintReview(slug, milestoneNumber, milestoneTitle, stateSource);
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
