import {
  MergeConflictError,
  mergePR as defaultMergePR,
} from '@goose-hub/core/connectors/github/merge-pr.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '@goose-hub/core/state-machine/transitions.js';
import { cleanupWorktree } from '@goose-hub/core/workspaces/worktree.js';
import { CACHE_KEY, bustCache } from '#shared/cache.js';
import { dispatchRetro } from '#shared/dispatch.js';
import type { Result } from '#shared/middleware.js';
import { getSourceForSlug } from '#shared/source.js';
import { getRepoRef } from './internal.js';

export type TransitionResult =
  | { ok: true; data: { ok: true; from: StateName; to: StateName } }
  | { ok: false; error: string; status: number; legalTargets?: readonly StateName[] };

/**
 * Approve gate (#186). Looks up the most recent `pr.opened` event for the
 * issue, merges that PR via the GitHub connector, emits `gate.approved` +
 * `pr.merged` events, and transitions factory:approved → factory:retrospecting.
 *
 * Optional `mergePRImpl` is dependency-injected so tests can stub the
 * REST call.
 */
export async function approveIssue(
  slug: string,
  id: string,
  options: {
    mergePRImpl?: typeof defaultMergePR;
  } = {},
): Promise<Result<{ ok: true; sha: string; prNumber: number }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  // Find the most recent pr.opened event for this issue.
  const events = eventStore.replay({ projectId: slug, workItemId });
  const prEvent = [...events].reverse().find((e) => e.kind === 'pr.opened');
  if (prEvent == null) {
    return {
      ok: false,
      error: 'no pr.opened event found — cannot approve without a PR',
      status: 400,
    };
  }
  const prNumber = (prEvent.payload as { prNumber?: number }).prNumber;
  if (typeof prNumber !== 'number') {
    return { ok: false, error: 'pr.opened event missing prNumber', status: 500 };
  }

  const token = process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0) {
    return { ok: false, error: 'GITHUB_TOKEN env var not set', status: 500 };
  }

  const mergePR = options.mergePRImpl ?? defaultMergePR;

  let merged: { sha: string; merged: boolean };
  try {
    merged = await mergePR({ repo: repoRef, prNumber, token });
  } catch (err) {
    if (err instanceof MergeConflictError) {
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'merge.conflict',
        payload: { prNumber },
      });
      await source.transitionState(id, 'factory:approved', 'factory:merge-conflict');
      return { ok: false, error: 'merge-conflict', status: 409 };
    }
    throw err;
  }

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'gate.approved',
    payload: { source: 'ui', prNumber },
  });
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'pr.merged',
    payload: { prNumber, sha: merged.sha },
  });

  // Clean up the dev worktree now that the PR is merged.
  const allEvents = eventStore.replay({ workItemId });
  const prOpenedEvent = allEvents
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpenedEvent != null) {
    const { devRunId } = prOpenedEvent.payload as { devRunId?: string };
    if (typeof devRunId === 'string') cleanupWorktree(devRunId);
  }

  await source.transitionState(id, 'factory:approved', 'factory:retrospecting');
  await source.comment(id, `Approved via Goose Hub UI; PR #${prNumber} merged (${merged.sha}).`);

  // Fire-and-forget the retrospective workflow. The webhook label-change
  // handler will also dispatch retro on the factory:retrospecting label, but
  // running it here avoids depending on webhook delivery for the post-merge
  // path. dispatchRetro is idempotent via the in-flight guard.
  dispatchRetro(slug, Number(id)).catch((err: unknown) => {
    logger.error('dispatchRetro after approve failed', { slug, id, error: String(err) });
  });

  return { ok: true, data: { ok: true, sha: merged.sha, prNumber } };
}

/**
 * Reject gate (#186). Records a rejection note as a GitHub comment, emits
 * `gate.rejected`, and transitions factory:approved → factory:needs-fix.
 * Does NOT touch the PR (humans handle PR closure manually if needed).
 */
export async function rejectIssue(
  slug: string,
  id: string,
  reason: unknown,
): Promise<Result<{ ok: true }>> {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, error: 'rejection reason is required', status: 400 };
  }
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'gate.rejected',
    payload: { source: 'ui', reason },
  });
  await source.comment(id, `Rejected at approval gate: ${reason}`);
  await source.transitionState(id, 'factory:approved', 'factory:needs-fix');

  return { ok: true, data: { ok: true } };
}

export async function transitionIssue(
  slug: string,
  id: string,
  from: unknown,
  to: unknown,
): Promise<TransitionResult> {
  if (from == null || to == null) {
    return { ok: false, error: "missing 'from' or 'to'", status: 400 };
  }
  if (!(STATES as readonly string[]).includes(from as string)) {
    return { ok: false, error: `invalid state name for 'from': ${from}`, status: 400 };
  }
  if (!(STATES as readonly string[]).includes(to as string)) {
    return { ok: false, error: `invalid state name for 'to': ${to}`, status: 400 };
  }

  const fromState = from as StateName;
  const toState = to as StateName;

  if (!isLegalTransition(fromState, toState)) {
    return {
      ok: false,
      error: 'illegal transition',
      status: 422,
      legalTargets: legalTargets(fromState),
    };
  }

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const workItemId = `github:${source.repoRef}#${id}`;
  await source.transitionState(workItemId, fromState, toState);

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: fromState, to: toState, by: 'ui' },
  });

  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true, from: fromState, to: toState } };
}
