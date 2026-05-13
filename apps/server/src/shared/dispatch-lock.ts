import { resolveGlobalSettingsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { parallelLock } from '@goose-hub/core/projects/parallel-lock.js';
import { logger } from '@goose-hub/core/logger.js';
import { getProject } from './projects.js';

type PendingWorkflowEntry = {
  issueNumber: number;
  dispatchFn: (slug: string, issueNumber: number) => Promise<void>;
};
const _workflowPending = new Map<string, PendingWorkflowEntry[]>();

function enqueueWorkflow(
  slug: string,
  issueNumber: number,
  dispatchFn: (slug: string, issueNumber: number) => Promise<void>,
): void {
  let queue = _workflowPending.get(slug);
  if (queue == null) {
    queue = [];
    _workflowPending.set(slug, queue);
  }
  // Dedup by (issueNumber, dispatchFn) so different workflows for the same issue can both queue.
  if (queue.some((e) => e.issueNumber === issueNumber && e.dispatchFn === dispatchFn)) return;
  queue.push({ issueNumber, dispatchFn });
}

function drainPending(slug: string): void {
  const queue = _workflowPending.get(slug);
  if (queue == null || queue.length === 0) return;
  const entry = queue.shift();
  if (queue.length === 0) _workflowPending.delete(slug);
  if (entry != null) {
    entry.dispatchFn(slug, entry.issueNumber).catch((err: unknown) => {
      logger.error('drainPending: dispatch failed', {
        slug,
        issueNumber: entry.issueNumber,
        error: String(err),
      });
    });
  }
}

export async function getMaxParallelAgents(slug: string): Promise<number> {
  const cfg = await getProject(slug);
  const settings = resolveGlobalSettingsForProject(slug, cfg?.budgets);
  return settings.maxParallelAgents ?? 1;
}

/**
 * Wraps a dispatch function body with the standard parallel-lock guard:
 * in-flight dedup, capacity check with queue, try/finally release+drain.
 *
 * The callback may return a post-lock thunk (runs after the lock is released)
 * or void/undefined (no post-lock work). This supports chaining to other
 * dispatchers that also need the same lock (e.g. dispatchInvestigationComplete
 * after dispatchInvestigate, dispatchRetro after dispatchResolveConflict).
 */
export async function withParallelLock(
  slug: string,
  issueNumber: number,
  callerName: string,
  dispatchFn: (slug: string, issueNumber: number) => Promise<void>,
  fn: () => Promise<(() => Promise<void>) | void>,
): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (parallelLock.isInFlight(slug, issueNumber)) {
    logger.warn(`${callerName}: duplicate in-flight, dropping`, { slug, issueNumber });
    return;
  }
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.info(`${callerName}: cap full, queuing work item`, {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    enqueueWorkflow(slug, issueNumber, dispatchFn);
    return;
  }
  let postLock: (() => Promise<void>) | void;
  try {
    postLock = await fn();
  } finally {
    parallelLock.release(slug, issueNumber);
    drainPending(slug);
  }
  if (postLock != null) {
    await postLock();
  }
}
