import { join } from 'node:path';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { runTriageBatch } from '../domains/workflows/triage-batch.js';
import { getSourceForSlug } from './source.js';

const _triageBatchInFlight = new Set<string>();
const _triageBatchPending = new Set<string>();
const _issueInFlight = new Set<string>();

function issueKey(slug: string, issueNumber: number): string {
  return `${slug}:${issueNumber}`;
}

/**
 * Centralised workflow dispatcher (#207). Domains never import from sibling
 * domains (STANDARDS.md). Webhooks, the projects router, and any other
 * caller that needs to kick off a workflow goes through these helpers.
 *
 * Slice workflows are dynamic-imported by URL because `slices/` lives at the
 * repo root (outside any workspace package) — see FACTORY_RULES rule 28a.
 * Resolving them via `import.meta.url` keeps the dispatcher portable across
 * worktrees.
 */

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** Run the triage batch for a project. Coalesces concurrent calls per slug. */
export function dispatchTriageBatch(slug: string): Promise<void> {
  if (_triageBatchInFlight.has(slug)) {
    _triageBatchPending.add(slug);
    return Promise.resolve();
  }
  _triageBatchInFlight.add(slug);
  return Promise.resolve()
    .then(() => runTriageBatch(slug))
    .catch((err: unknown) => {
      logger.error('dispatchTriageBatch failed', { slug, error: String(err) });
    })
    .finally(() => {
      _triageBatchInFlight.delete(slug);
      if (_triageBatchPending.delete(slug)) {
        void dispatchTriageBatch(slug);
      }
    });
}

/** Run the investigate workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchInvestigate(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchInvestigate: already in-flight, dropping duplicate', {
      slug,
      issueNumber,
    });
    return;
  }
  _issueInFlight.add(key);
  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runInvestigateWorkflow } = (await import(
      new URL('../../../../slices/investigate/workflow.js', import.meta.url).href
    )) as {
      runInvestigateWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        repoRoot: string,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchInvestigate: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    await runInvestigateWorkflow(item, source, slug, REPO_ROOT);
  } finally {
    _issueInFlight.delete(key);
  }
}

/** Run the M7 fix-issue workflow for a single issue (#183). Drops duplicate triggers for the same issue. */
export async function dispatchFixIssue(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchFixIssue: already in-flight, dropping duplicate', { slug, issueNumber });
    return;
  }
  _issueInFlight.add(key);
  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runFixIssueWorkflow } = (await import(
      new URL('../../../../slices/fix-issue/workflow.js', import.meta.url).href
    )) as {
      runFixIssueWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        repoRoot: string,
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchFixIssue: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());

    const mockDeps: Record<string, unknown> | undefined =
      process.env.MOCK_OPEN_PR === 'true'
        ? {
            openPRImpl: () =>
              Promise.resolve({
                prNumber: 999,
                prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
                branch: 'factory/mock-run',
                base: 'main',
              }),
            createWorktreeImpl: () => '/mock/worktree',
            cleanupWorktreeImpl: () => undefined,
            resolveWorktreeHeadShaImpl: () => 'mock-sha-abc123',
          }
        : undefined;

    await runFixIssueWorkflow(item, source, slug, REPO_ROOT, mockDeps);
  } finally {
    _issueInFlight.delete(key);
  }
}

/** Run the merge conflict resolution workflow for a single issue. Drops duplicate triggers. */
export async function dispatchResolveConflict(
  slug: string,
  issueNumber: number,
): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchResolveConflict: already in-flight, dropping duplicate', {
      slug,
      issueNumber,
    });
    return;
  }
  _issueInFlight.add(key);
  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runResolveConflictWorkflow } = (await import(
      new URL('../../../../slices/resolve-conflict/workflow.js', import.meta.url).href
    )) as {
      runResolveConflictWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        repoRoot: string,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchResolveConflict: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    await runResolveConflictWorkflow(item, source, slug, REPO_ROOT);
  } finally {
    _issueInFlight.delete(key);
  }
}

/** Run the QA holdout workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchQa(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchQa: already in-flight, dropping duplicate', { slug, issueNumber });
    return;
  }
  _issueInFlight.add(key);
  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runQaWorkflow } = (await import(
      new URL('../../../../slices/qa/workflow.js', import.meta.url).href
    )) as {
      runQaWorkflow: (
        item: unknown,
        source: unknown,
        projectId: string,
        targetRepo: string,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchQa: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    await runQaWorkflow(item, source, source.projectId, item.repoRef ?? slug);
  } finally {
    _issueInFlight.delete(key);
  }
}

/** Run the Review holdout workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchReview(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchReview: already in-flight, dropping duplicate', { slug, issueNumber });
    return;
  }
  _issueInFlight.add(key);
  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runReviewWorkflow } = (await import(
      new URL('../../../../slices/review/workflow.js', import.meta.url).href
    )) as {
      runReviewWorkflow: (
        item: unknown,
        source: unknown,
        projectId: string,
        targetRepo: string,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchReview: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    await runReviewWorkflow(item, source, source.projectId, item.repoRef ?? slug);
  } finally {
    _issueInFlight.delete(key);
  }
}

/**
 * Auto-transition from investigation-complete based on confidence.
 * Low confidence → gate-pending (human review required).
 * Medium/high → dev-ready (proceed automatically).
 */
async function dispatchInvestigationComplete(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchInvestigationComplete: already in-flight, dropping duplicate', {
      slug,
      issueNumber,
    });
    return;
  }
  _issueInFlight.add(key);
  try {
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchInvestigationComplete: no source for slug', { slug });
      return;
    }

    const item = await source.getItem(issueNumber.toString());
    if (item.state !== 'factory:investigation-complete') {
      logger.info('dispatchInvestigationComplete: state already moved', {
        slug,
        issueNumber,
        state: item.state,
      });
      return;
    }

    const workItemId = `github:${source.repoRef}#${issueNumber}`;
    const allEvents = eventStore.replay({ projectId: slug, workItemId });
    const investigationEvents = allEvents.filter((e) => e.kind === 'agent.investigation-complete');
    const latest = investigationEvents.at(-1);
    const confidence =
      (latest?.payload as { investigate?: { confidence?: string } } | null)?.investigate
        ?.confidence ?? 'medium';

    const targetState = confidence === 'low' ? 'factory:gate-pending' : 'factory:dev-ready';
    await source.transitionState(workItemId, 'factory:investigation-complete', targetState);

    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:investigation-complete', to: targetState, by: 'orchestrator' },
    });

    if (targetState === 'factory:gate-pending') {
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'gate.awaiting-human',
        payload: {
          reason:
            'Investigation confidence is low — human review required before proceeding to dev.',
        },
      });
    }

    logger.info('dispatchInvestigationComplete: transitioned', { slug, issueNumber, targetState });
  } finally {
    _issueInFlight.delete(key);
  }
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
