/**
 * PRD review actions (M13.08 + M13.12).
 *
 * `approvePRD` advances a `factory:prd-review` issue to `factory:decomposing`.
 * `revisePRD` re-dispatches write-prd with human concerns, staying in prd-review.
 * `declinePRD` closes the work item (transitions to factory:done).
 * `proceedToPrd` skips remaining grill rounds and goes straight to write-prd.
 * `rejectPRD` is kept for backwards compatibility but is a no-op alias for
 * `declinePRD`.
 */
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import {
  activeDiscoverSessionId,
  latestDiscoverSessionId,
} from '@goose-hub/core/workflows/grill-and-prd/discover-session.js';
import type { PRDOutput } from '@goose-hub/skills/write-prd/schema.js';
import { dispatchDecomposePrd, dispatchGrillAndPrd, dispatchRevisePrd } from '#shared/dispatch.js';
import type { Result } from '#shared/middleware.js';
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

  await moveOrForce(source, id, 'factory:prd-review', 'factory:decomposing');
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
    to: 'factory:decomposing',
    by: 'ui',
    extraPayload: sessionPayload,
  });

  // Fire decompose-prd outside the response path. Mirrors the
  // dispatchRetro-after-approve pattern in resolve-conflict so the
  // workflow runs without waiting on webhook delivery.
  dispatchDecomposePrd(slug, Number(id)).catch((err: unknown) => {
    logger.error('dispatchDecomposePrd after approvePRD failed', {
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

  const latestPrd = await resolveLatestPrd({
    projectId: slug,
    workItemId,
    loadLegacyComments: () => source.listComments(id),
  });
  const priorPrd = latestPrd?.prd != null ? (latestPrd.prd as PRDOutput) : undefined;
  if (priorPrd == null) {
    await source.comment(
      id,
      'revise-prd: no PRD draft found for this issue. Returning to needs-human.',
    );
    await source.forceState(id, 'factory:needs-human');
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

  await moveOrForce(source, id, 'factory:gate-pending', 'factory:grilling');
  const discoverSessionId = activeDiscoverSessionId(slug, workItemId);
  const sessionPayload =
    discoverSessionId != null ? { discoverSessionId } : ({} as Record<string, never>);

  emitStateTransitionEvent({
    projectId: slug,
    workItemId,
    from: 'factory:gate-pending',
    to: 'factory:grilling',
    by: 'ui-proceed',
    extraPayload: sessionPayload,
  });

  // Dispatch grill-and-prd with readyForPRD forced by marking priorReplies as complete.
  // We achieve this by dispatching normally — the griller will see the prior replies
  // and determine readyForPRD=true given the context. The /proceed-to-prd action
  // simply moves to grilling so the orchestrator picks it up on the next tick.
  // For immediate dispatch, fire dispatchGrillAndPrd.
  dispatchGrillAndPrd(slug, Number(id)).catch((err: unknown) => {
    logger.error('dispatchGrillAndPrd after proceedToPrd failed', {
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
