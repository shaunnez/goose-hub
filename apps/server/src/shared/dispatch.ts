import { join } from 'node:path';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { parseAcceptanceCriteria } from '../domains/issues/parse-acceptance.js';
import { runRetroForItem } from '../domains/workflows/retro-batch.js';
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
export async function dispatchResolveConflict(slug: string, issueNumber: number): Promise<void> {
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
    // Fire-and-forget retro after conflict resolution + merge, same pattern as
    // approveIssue. The label-change webhook also triggers dispatchRetro on
    // factory:retrospecting; running it here avoids waiting for webhook delivery.
    dispatchRetro(slug, issueNumber).catch((err: unknown) => {
      logger.error('dispatchRetro after resolve-conflict failed', {
        slug,
        issueNumber,
        error: String(err),
      });
    });
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
        projectSlug: string,
        targetRepo: string,
        deps?: {
          verifyCommands?: Array<{
            ac: string;
            command: string;
            expected: string;
            tolerance: string;
          }>;
        },
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchQa: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    const verifyCommands = parseAcceptanceCriteria(item.body ?? '');
    await runQaWorkflow(item, source, slug, item.repoRef ?? slug, { verifyCommands });
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
        projectSlug: string,
        targetRepo: string,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchReview: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    await runReviewWorkflow(item, source, slug, item.repoRef ?? slug);
  } finally {
    _issueInFlight.delete(key);
  }
}

/**
 * Run the retrospective workflow for a single issue. Drops concurrent
 * duplicates via the in-flight guard, AND skips items whose state already
 * advanced past factory:retrospecting — retro is triggered both directly
 * from approveIssue and via the factory:retrospecting label webhook, so
 * sequential duplicate triggers must no-op once the workflow has run.
 */
export async function dispatchRetro(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchRetro: already in-flight, dropping duplicate', { slug, issueNumber });
    return;
  }
  _issueInFlight.add(key);
  try {
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchRetro: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    if (item.state !== 'factory:retrospecting') {
      logger.info('dispatchRetro: state already advanced, skipping', {
        slug,
        issueNumber,
        state: item.state,
      });
      return;
    }
    await runRetroForItem(item, source, slug);
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
  if (labelName === 'factory:retrospecting') {
    await dispatchRetro(slug, issueNumber);
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

const RESUME_WORKFLOWS: Partial<Record<StateName, ResumeEntry>> = {
  'factory:dev-ready': { targetState: 'factory:dev-ready', dispatch: dispatchFixIssue },
  'factory:in-progress': { targetState: 'factory:dev-ready', dispatch: dispatchFixIssue },
  'factory:needs-qa': { targetState: 'factory:needs-qa', dispatch: dispatchQa },
  'factory:needs-review': { targetState: 'factory:needs-review', dispatch: dispatchReview },
  'factory:merge-conflict': {
    targetState: 'factory:merge-conflict',
    dispatch: dispatchResolveConflict,
  },
  'factory:investigating': { targetState: 'factory:investigating', dispatch: dispatchInvestigate },
  'factory:retrospecting': { targetState: 'factory:retrospecting', dispatch: dispatchRetro },
};

/**
 * Resume an orphaned or stalled run. Looks up the issue's current state,
 * forces it back to the canonical trigger state for that workflow (e.g.
 * factory:in-progress → factory:dev-ready), then re-dispatches. Uses
 * forceState rather than transitionState because recovery transitions are
 * not always legal in the normal workflow graph.
 */
export async function dispatchResumeIssue(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
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

  const entry = RESUME_WORKFLOWS[fromState];
  if (entry == null) {
    logger.warn('dispatchResumeIssue: no resume handler for state', {
      slug,
      issueNumber,
      fromState,
    });
    return;
  }

  if (entry.targetState !== fromState) {
    await source.forceState(workItemId, entry.targetState);
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'state.transitioned',
      payload: { from: fromState, to: entry.targetState, by: 'resume' },
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
