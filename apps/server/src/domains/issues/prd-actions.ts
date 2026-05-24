/**
 * PRD review actions (M13.08 + M13.12).
 *
 * `approvePRD` advances a `factory:prd-review` issue to `factory:dev-ready`.
 * `revisePRD` re-dispatches write-prd with human concerns, staying in prd-review.
 * `declinePRD` closes the work item (transitions to factory:done).
 * `proceedToPrd` skips remaining grill rounds and goes straight to write-prd.
 * `rejectPRD` is kept for backwards compatibility but is a no-op alias for
 * `declinePRD`.
 */
import { getUseMultiAgentPipeline } from '@goose-hub/core/db/repositories/project-settings.js';
import {
  emitStateTransitionEvent,
  transitionAndEmitState,
} from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { resolve, supersede } from '@goose-hub/core/interventions/reducer.js';
import { listInterventions } from '@goose-hub/core/interventions/repository.js';
import { ACTIVE_INTERVENTION_STATUSES } from '@goose-hub/core/interventions/types.js';
import { logger } from '@goose-hub/core/logger.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import {
  activeDiscoverSessionId,
  latestDiscoverSessionId,
} from '@goose-hub/core/workflows/grill-and-prd/discover-session.js';
import type { PRDOutput } from '@goose-hub/skills/write-prd/schema.js';
import { dispatchFixIssue, dispatchRetryWritePrd, dispatchRevisePrd } from '#shared/dispatch.js';
import type { Result } from '#shared/middleware.js';
import { getProject } from '#shared/projects.js';
import { getSourceForSlug } from '#shared/source.js';
import { getRepoRef } from './internal.js';

async function moveOrForce(
  source: import('@goose-hub/core/state-source/interface.js').StateSource,
  itemId: string,
  from: StateName,
  to: StateName,
): Promise<void> {
  try {
    await source.transitionState(itemId, from, to);
  } catch {
    await source.forceState(itemId, to);
  }
}

function clearActivePrdReviewInterventions(input: {
  projectId: string;
  workItemId: string;
  reason: string;
}): void {
  const interventions = listInterventions({
    projectId: input.projectId,
    workItemId: input.workItemId,
    status: [...ACTIVE_INTERVENTION_STATUSES],
  }).filter((intervention) => intervention.interventionType === 'prd_review');

  for (const intervention of interventions) {
    const actor = 'prd-actions';
    if (['OPEN', 'PROPOSED', 'APPLIED', 'VERIFIED'].includes(intervention.status)) {
      const resolved = resolve({
        id: intervention.id,
        expectedVersion: intervention.version,
        actor,
        reason: input.reason,
      });
      if (resolved.ok) continue;
    }
    supersede({
      id: intervention.id,
      expectedVersion: intervention.version,
      actor,
      supersededBy: input.reason,
      evidence: {
        reason: input.reason,
        workItemId: input.workItemId,
        interventionType: intervention.interventionType,
      },
    });
  }
}

async function approvedPrdNextStep(slug: string): Promise<'spec-author' | 'fix-issue'> {
  const project = await getProject(slug);
  const useMultiAgent = project != null ? getUseMultiAgentPipeline(project.id) : false;
  return useMultiAgent ? 'spec-author' : 'fix-issue';
}

export async function approvePRD(slug: string, id: string): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  const item = await source.getItem(id);
  if (item.state !== 'factory:prd-review') {
    return {
      ok: false,
      error: `expected state factory:prd-review, got ${item.state}`,
      status: 409,
    };
  }

  clearActivePrdReviewInterventions({
    projectId: slug,
    workItemId,
    reason: 'PRD approved',
  });
  await moveOrForce(source, id, 'factory:prd-review', 'factory:dev-ready');
  const discoverSessionId = latestDiscoverSessionId(slug, workItemId);
  const sessionPayload =
    discoverSessionId != null ? { discoverSessionId } : ({} as Record<string, never>);

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.approved',
    payload: { source: 'ui', ...sessionPayload },
  });
  emitStateTransitionEvent({
    projectId: slug,
    workItemId,
    from: 'factory:prd-review',
    to: 'factory:dev-ready',
    by: 'ui',
    extraPayload: sessionPayload,
  });

  const next = await approvedPrdNextStep(slug);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.lifecycle-routed',
    payload: {
      from: 'factory:prd-review',
      to: 'factory:dev-ready',
      skipped: 'decompose-issues',
      next,
      source: 'ui',
      ...sessionPayload,
    },
  });

  dispatchFixIssue(slug, Number(id)).catch((err: unknown) => {
    logger.error('dispatchFixIssue after approvePRD failed', {
      slug,
      id,
      error: String(err),
    });
  });

  return { ok: true, data: { ok: true } };
}

export async function revisePRD(
  slug: string,
  id: string,
  concerns: string[],
): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  const item = await source.getItem(id);
  if (item.state !== 'factory:prd-review') {
    return {
      ok: false,
      error: `expected state factory:prd-review, got ${item.state}`,
      status: 409,
    };
  }

  clearActivePrdReviewInterventions({
    projectId: slug,
    workItemId,
    reason: 'PRD revision requested',
  });
  const latestPrd = await resolveLatestPrd({
    projectId: slug,
    workItemId,
  });
  const priorPrd = latestPrd?.prd != null ? (latestPrd.prd as PRDOutput) : undefined;
  if (priorPrd == null) {
    await source.comment(
      id,
      'revise-prd: no PRD draft found for this issue. Returning to needs-human.',
    );
    await transitionAndEmitState({
      source,
      projectId: slug,
      itemId: id,
      workItemId,
      from: 'factory:prd-review',
      to: 'factory:needs-human',
      by: 'ui',
      mode: 'forced',
      reason: 'no PRD draft found for revision',
    });
    return { ok: false, error: 'no PRD draft found for revision', status: 409 };
  }

  const discoverSessionId = latestDiscoverSessionId(slug, workItemId);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.revised',
    payload: {
      source: 'ui',
      concerns,
      ...(discoverSessionId != null ? { discoverSessionId } : {}),
    },
  });

  // Re-dispatch write-prd with concerns; state stays prd-review.
  dispatchRevisePrd(slug, Number(id), priorPrd, concerns).catch((err: unknown) => {
    logger.error('dispatchRevisePrd after revisePRD failed', {
      slug,
      id,
      error: String(err),
    });
  });

  return { ok: true, data: { ok: true } };
}

export async function declinePRD(slug: string, id: string): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  const item = await source.getItem(id);
  if (item.state !== 'factory:prd-review') {
    return {
      ok: false,
      error: `expected state factory:prd-review, got ${item.state}`,
      status: 409,
    };
  }

  clearActivePrdReviewInterventions({
    projectId: slug,
    workItemId,
    reason: 'PRD declined',
  });
  await moveOrForce(source, id, 'factory:prd-review', 'factory:done');
  const discoverSessionId = latestDiscoverSessionId(slug, workItemId);
  const sessionPayload =
    discoverSessionId != null ? { discoverSessionId } : ({} as Record<string, never>);

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.declined',
    payload: { source: 'ui', ...sessionPayload },
  });
  emitStateTransitionEvent({
    projectId: slug,
    workItemId,
    from: 'factory:prd-review',
    to: 'factory:done',
    by: 'ui',
    extraPayload: sessionPayload,
  });

  return { ok: true, data: { ok: true } };
}

export async function proceedToPrd(slug: string, id: string): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  const item = await source.getItem(id);
  if (item.state !== 'factory:gate-pending') {
    return {
      ok: false,
      error: `expected state factory:gate-pending, got ${item.state}`,
      status: 409,
    };
  }

  await moveOrForce(source, id, 'factory:gate-pending', 'factory:prd-drafting');
  const discoverSessionId = activeDiscoverSessionId(slug, workItemId);
  const sessionPayload =
    discoverSessionId != null ? { discoverSessionId } : ({} as Record<string, never>);

  emitStateTransitionEvent({
    projectId: slug,
    workItemId,
    from: 'factory:gate-pending',
    to: 'factory:prd-drafting',
    by: 'ui-proceed',
    extraPayload: sessionPayload,
  });

  dispatchRetryWritePrd(slug, Number(id)).catch((err: unknown) => {
    logger.error('dispatchRetryWritePrd after proceedToPrd failed', {
      slug,
      id,
      error: String(err),
    });
  });

  return { ok: true, data: { ok: true } };
}

export async function rejectPRD(slug: string, id: string): Promise<Result<{ ok: true }>> {
  // Legacy endpoint — kept for backwards compatibility. Delegates to declinePRD.
  return declinePRD(slug, id);
}
