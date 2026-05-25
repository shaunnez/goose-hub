import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { parallelLock } from '@goose-hub/core/projects/parallel-lock.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { maybeFireSprintReview } from '../domains/workflows/sprint-review-trigger.js';
import {
  dispatchFixIssue,
  dispatchInvestigate,
  dispatchInvestigationComplete,
  dispatchParallelImplement,
  dispatchResolveConflict,
} from './dispatch-dev.js';
import {
  dispatchDecomposePrd,
  dispatchFraming,
  dispatchGrillAndPrd,
  dispatchRetryWritePrd,
} from './dispatch-discover.js';
import {
  dispatchNeedsFix,
  dispatchQa,
  dispatchQaFailed,
  dispatchRetro,
  dispatchReview,
} from './dispatch-qa-review.js';
import { dispatchTriageBatch } from './dispatch-triage.js';
import { getSourceForSlug } from './source.js';

/**
 * Handles terminal labels (factory:archived, factory:rejected) that bypass the
 * retro path. Fetches the issue's milestone and fires maybeFireSprintReview so
 * that the sprint-review trigger runs even when an issue is archived or rejected
 * without going through retrospective (PLAN §12.6).
 */
async function dispatchTerminalLabel(slug: string, issueNumber: number): Promise<void> {
  const source = await getSourceForSlug(slug);
  if (source == null) {
    logger.error('dispatchTerminalLabel: no source for slug', { slug, issueNumber });
    return;
  }
  const item = await source.getItem(issueNumber.toString());
  const milestoneNumber = item.milestoneId != null ? Number(item.milestoneId) : null;
  const milestoneTitle = item.milestoneTitle ?? null;
  if (milestoneNumber == null || Number.isNaN(milestoneNumber) || milestoneTitle == null) {
    logger.info('dispatchTerminalLabel: no milestoneId, skipping sprint-review check', {
      slug,
      issueNumber,
    });
    return;
  }
  // Fire-and-forget; errors logged inside maybeFireSprintReview.
  void maybeFireSprintReview(slug, milestoneNumber, milestoneTitle, source);
}

/**
 * Webhook label-driven dispatcher. Routes the factory:* label to the right
 * workflow without requiring the webhook handler to know about the
 * `workflows` or `slices` directory layout.
 */
export async function dispatchForLabel(
  slug: string,
  issueNumber: number,
  labelName: string,
): Promise<void> {
  if (labelName === 'factory:triaging') {
    await dispatchTriageBatch(slug);
    return;
  }
  if (labelName === 'factory:investigating') {
    await dispatchInvestigate(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:investigation-complete') {
    await dispatchInvestigationComplete(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:dev-ready') {
    await dispatchFixIssue(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:spec-ready') {
    await dispatchParallelImplement(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:needs-qa') {
    await dispatchQa(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:needs-review') {
    await dispatchReview(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:merge-conflict') {
    await dispatchResolveConflict(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:retrospecting') {
    await dispatchRetro(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:qa-failed') {
    await dispatchQaFailed(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:needs-fix') {
    await dispatchNeedsFix(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:grilling') {
    await dispatchGrillAndPrd(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:framing') {
    await dispatchFraming(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:decomposing') {
    await dispatchDecomposePrd(slug, issueNumber);
    return;
  }
  // Terminal labels that bypass retro — check for sprint-review eligibility.
  if (labelName === 'factory:archived' || labelName === 'factory:rejected') {
    await dispatchTerminalLabel(slug, issueNumber);
    return;
  }
  logger.info('dispatchForLabel: no workflow for label', { slug, labelName });
}

/**
 * Dispatch the workflow that matches an issue's current factory:* state.
 * Webhook-free escape hatch used by e2e tests so they don't depend on
 * GitHub webhook delivery to the local server.
 */
export async function dispatchForIssue(slug: string, issueNumber: number): Promise<void> {
  const source = await getSourceForSlug(slug);
  if (source == null) {
    logger.error('dispatchForIssue: no source for slug', { slug });
    return;
  }
  const item = await source.getItem(issueNumber.toString());
  await dispatchForLabel(slug, issueNumber, item.state);
}

type ResumeEntry = {
  targetState: StateName;
  dispatch: (slug: string, issueNumber: number) => Promise<void>;
};

interface InterventionDispatchContext {
  id: string;
  correlationId: string;
}

function interventionEventPayload(
  intervention: InterventionDispatchContext | undefined,
): Record<string, string> {
  if (intervention == null) return {};
  return {
    interventionId: intervention.id,
    causedByInterventionId: intervention.id,
    correlationId: intervention.correlationId,
  };
}

const RESUME_WORKFLOWS: Partial<Record<StateName, ResumeEntry>> = {
  // Re-run the full triage batch so a stalled triage or repo-match run is retried.
  'factory:triaging': {
    targetState: 'factory:triaging',
    dispatch: (slug: string, _issueNumber: number) => dispatchTriageBatch(slug),
  },
  'factory:dev-ready': { targetState: 'factory:dev-ready', dispatch: dispatchFixIssue },
  'factory:spec-ready': { targetState: 'factory:spec-ready', dispatch: dispatchParallelImplement },
  'factory:in-progress': { targetState: 'factory:dev-ready', dispatch: dispatchFixIssue },
  'factory:needs-qa': { targetState: 'factory:needs-qa', dispatch: dispatchQa },
  'factory:needs-review': { targetState: 'factory:needs-review', dispatch: dispatchReview },
  'factory:merge-conflict': {
    targetState: 'factory:merge-conflict',
    dispatch: dispatchResolveConflict,
  },
  'factory:investigating': { targetState: 'factory:investigating', dispatch: dispatchInvestigate },
  'factory:retrospecting': { targetState: 'factory:retrospecting', dispatch: dispatchRetro },
  'factory:qa-failed': { targetState: 'factory:needs-fix', dispatch: dispatchNeedsFix },
  'factory:needs-fix': { targetState: 'factory:needs-fix', dispatch: dispatchNeedsFix },
  // Discover lane
  'factory:framing': { targetState: 'factory:framing', dispatch: dispatchFraming },
  'factory:grilling': { targetState: 'factory:grilling', dispatch: dispatchGrillAndPrd },
  // factory:gate-pending is handled above with lane-origin inspection; it is
  // intentionally absent from this table so the special-case runs first.
  'factory:prd-drafting': { targetState: 'factory:prd-drafting', dispatch: dispatchRetryWritePrd },
  'factory:decomposing': { targetState: 'factory:decomposing', dispatch: dispatchDecomposePrd },
};

/**
 * Resume an orphaned or stalled run. Looks up the issue's current state,
 * forces it back to the canonical trigger state for that workflow (e.g.
 * factory:in-progress → factory:dev-ready), then re-dispatches. Uses
 * forceState rather than transitionState because recovery transitions are
 * not always legal in the normal workflow graph.
 *
 * factory:gate-pending is handled specially: the last `state.transitioned`
 * event that landed the issue in gate-pending is inspected for its `from`
 * field to determine which lane to resume. Only `from: factory:grilling`
 * supports auto-resume (routes back to the grill workflow). All other origins
 * require manual triage.
 */
export async function dispatchResumeIssue(
  slug: string,
  issueNumber: number,
  options: { intervention?: InterventionDispatchContext } = {},
): Promise<void> {
  if (parallelLock.isInFlight(slug, issueNumber)) {
    logger.warn('dispatchResumeIssue: already in-flight, dropping duplicate', {
      slug,
      issueNumber,
    });
    return;
  }
  const source = await getSourceForSlug(slug);
  if (source == null) {
    logger.error('dispatchResumeIssue: no source for slug', { slug });
    return;
  }
  const workItemId = `github:${source.repoRef}#${issueNumber}`;
  const item = await source.getItem(issueNumber.toString());
  const fromState = item.state;

  // gate-pending is lane-agnostic. Inspect the last state.transitioned event
  // that moved the issue into gate-pending to determine which lane to resume.
  if (fromState === 'factory:gate-pending') {
    const allEvents = eventStore.replay({ projectId: slug, workItemId });
    const lastToGatePending = [...allEvents]
      .reverse()
      .find(
        (e) =>
          e.kind === 'state.transitioned' &&
          (e.payload as { to?: string }).to === 'factory:gate-pending',
      );
    const transitionedFrom = (lastToGatePending?.payload as { from?: string } | undefined)?.from;

    if (transitionedFrom === 'factory:grilling') {
      logger.info('dispatchResumeIssue: gate-pending from grilling, resuming discover lane', {
        slug,
        issueNumber,
      });
      await source.forceState(workItemId, 'factory:grilling');
      emitStateTransitionEvent({
        projectId: slug,
        workItemId,
        from: fromState,
        to: 'factory:grilling',
        by: 'resume',
        extraPayload: interventionEventPayload(options.intervention),
      });
      await dispatchGrillAndPrd(slug, issueNumber);
      return;
    }

    logger.warn('dispatchResumeIssue: gate-pending from unknown lane, cannot auto-resume', {
      slug,
      issueNumber,
      transitionedFrom,
    });
    return;
  }

  // needs-human: inspect last agent.run-failed to determine which skill to retry.
  if (fromState === 'factory:needs-human') {
    const allEvents = eventStore.replay({ projectId: slug, workItemId });
    const lastRunFailed = [...allEvents].reverse().find((e) => e.kind === 'agent.run-failed');
    const failedPayload = lastRunFailed?.payload as
      | { skill?: string; runDisposition?: string; runId?: string }
      | undefined;
    const failedSkill = failedPayload?.skill;

    if (failedSkill === 'parallel-implement' && failedPayload?.runDisposition === 'budget-killed') {
      logger.info(
        'dispatchResumeIssue: needs-human from budget-killed parallel-implement, resuming to spec-ready',
        { slug, issueNumber },
      );
      await source.forceState(workItemId, 'factory:spec-ready');
      emitStateTransitionEvent({
        projectId: slug,
        workItemId,
        from: fromState,
        to: 'factory:spec-ready',
        by: 'resume',
        extraPayload: {
          ...interventionEventPayload(options.intervention),
          resumeReason: 'budget-killed-after-persist',
          priorRunId: failedPayload.runId ?? '',
        },
      });
      await dispatchParallelImplement(slug, issueNumber);
      return;
    }

    if (failedSkill === 'spec-author') {
      logger.info(
        'dispatchResumeIssue: needs-human from spec-author failure, resuming to dev-ready',
        { slug, issueNumber },
      );
      await source.forceState(workItemId, 'factory:dev-ready');
      emitStateTransitionEvent({
        projectId: slug,
        workItemId,
        from: fromState,
        to: 'factory:dev-ready',
        by: 'resume',
        extraPayload: interventionEventPayload(options.intervention),
      });
      await dispatchFixIssue(slug, issueNumber);
      return;
    }

    if (failedSkill === 'investigate') {
      logger.info(
        'dispatchResumeIssue: needs-human from investigate failure, resuming to investigating',
        { slug, issueNumber },
      );
      await source.forceState(workItemId, 'factory:investigating');
      emitStateTransitionEvent({
        projectId: slug,
        workItemId,
        from: fromState,
        to: 'factory:investigating',
        by: 'resume',
        extraPayload: interventionEventPayload(options.intervention),
      });
      await dispatchInvestigate(slug, issueNumber);
      return;
    }

    logger.warn('dispatchResumeIssue: needs-human from unknown skill, cannot auto-resume', {
      slug,
      issueNumber,
      failedSkill,
    });
    return;
  }

  const entry = RESUME_WORKFLOWS[fromState];
  if (entry == null) {
    logger.warn('dispatchResumeIssue: no resume handler for state', {
      slug,
      issueNumber,
      fromState,
    });
    return;
  }

  // If the issue reached in-progress via spec-ready it was launched by the parallel-implement
  // pipeline. Resume by restoring spec-ready and re-dispatching (clean restart — no WP-level
  // checkpoint recovery across server restarts). If it arrived via dev-ready, fall through to
  // the legacy fix-issue path in RESUME_WORKFLOWS.
  if (fromState === 'factory:in-progress') {
    const allEvents = eventStore.replay({ projectId: slug, workItemId });
    const lastToInProgress = [...allEvents]
      .reverse()
      .find(
        (e) =>
          e.kind === 'state.transitioned' &&
          (e.payload as { to?: string }).to === 'factory:in-progress',
      );
    const arrivedFrom = (lastToInProgress?.payload as { from?: string } | undefined)?.from;

    if (arrivedFrom === 'factory:spec-ready') {
      logger.info('dispatchResumeIssue: in-progress via M19, resuming from spec-ready', {
        slug,
        issueNumber,
      });
      await source.forceState(workItemId, 'factory:spec-ready');
      emitStateTransitionEvent({
        projectId: slug,
        workItemId,
        from: fromState,
        to: 'factory:spec-ready',
        by: 'resume',
        extraPayload: interventionEventPayload(options.intervention),
      });
      await dispatchParallelImplement(slug, issueNumber);
      return;
    }
    // Legacy path: fall through to RESUME_WORKFLOWS entry (dev-ready → fix-issue)
  }

  if (entry.targetState !== fromState) {
    await source.forceState(workItemId, entry.targetState);
    emitStateTransitionEvent({
      projectId: slug,
      workItemId,
      from: fromState,
      to: entry.targetState,
      by: 'resume',
      extraPayload: interventionEventPayload(options.intervention),
    });
    logger.info('dispatchResumeIssue: forced state for resume', {
      slug,
      issueNumber,
      fromState,
      targetState: entry.targetState,
    });
  }

  logger.info('dispatchResumeIssue: dispatching workflow', {
    slug,
    issueNumber,
    state: entry.targetState,
  });
  await entry.dispatch(slug, issueNumber);
}
