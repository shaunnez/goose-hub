/**
 * PRD review actions (M13.08).
 *
 * `approvePRD` advances a `factory:prd-review` issue to `factory:decomposing`
 * (a legal transition) so the orchestrator can pick it up and run the
 * decompose-prd workflow on the next tick. `rejectPRD` returns the issue to
 * `factory:grilling` and posts a comment explaining the rejection. The
 * grilling → decomposing path is not direct-edge legal, so the helper falls
 * back to `forceState` if `transitionState` throws.
 */
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { dispatchDecomposePrd, dispatchGrillAndPrd } from '#shared/dispatch.js';
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

export async function rejectPRD(slug: string, id: string): Promise<Result<{ ok: true }>> {
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

  await source.comment(
    id,
    'PRD rejected. Please ask me further questions to refine the requirements and produce a better PRD.',
  );
  await moveOrForce(source, id, 'factory:prd-review', 'factory:grilling');

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'prd.rejected',
    payload: { source: 'ui' },
  });
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: 'factory:prd-review', to: 'factory:grilling', by: 'ui' },
  });

  // Re-enter the grill loop without waiting on webhook delivery.
  dispatchGrillAndPrd(slug, Number(id)).catch((err: unknown) => {
    logger.error('dispatchGrillAndPrd after rejectPRD failed', {
      slug,
      id,
      error: String(err),
    });
  });

  return { ok: true, data: { ok: true } };
}
