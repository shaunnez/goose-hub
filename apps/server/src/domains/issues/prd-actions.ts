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
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { PRDOutput } from '@goose-hub/skills/write-prd/schema.js';
import { dispatchDecomposePrd, dispatchGrillAndPrd, dispatchRevisePrd } from '#shared/dispatch.js';
import type { Result } from '#shared/middleware.js';
import { getSourceForSlug } from '#shared/source.js';
import { getRepoRef } from './internal.js';

function parsePrdFromCommentBody(body: string): PRDOutput | null {
  const fenceMatch = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (fenceMatch == null) return null;
  try {
    return JSON.parse(fenceMatch[1]) as PRDOutput;
  } catch {
    return null;
  }
}

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

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.approved',
    payload: { source: 'ui' },
  });
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: 'factory:prd-review', to: 'factory:decomposing', by: 'ui' },
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

  // Fetch the latest PRD comment and parse its JSON blob.
  const comments = await source.listComments(id);
  const prdComment = [...comments].reverse().find((c) => c.body.startsWith('<!-- factory:prd -->'));
  const priorPrd = prdComment != null ? parsePrdFromCommentBody(prdComment.body) : null;

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.revised',
    payload: { source: 'ui', concerns },
  });

  // Re-dispatch write-prd with concerns; state stays prd-review.
  dispatchRevisePrd(slug, Number(id), priorPrd ?? undefined, concerns).catch((err: unknown) => {
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

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.declined',
    payload: { source: 'ui' },
  });
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: 'factory:prd-review', to: 'factory:done', by: 'ui' },
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

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: 'factory:gate-pending', to: 'factory:grilling', by: 'ui-proceed' },
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
