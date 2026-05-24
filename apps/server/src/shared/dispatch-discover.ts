import { transitionAndEmitState } from '@goose-hub/core/event-stream/state-transition.js';
import { logger } from '@goose-hub/core/logger.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import { parallelLock } from '@goose-hub/core/projects/parallel-lock.js';
import { runDecomposePrdWorkflow } from '@goose-hub/core/workflows/decompose-prd.js';
import { runGrillAndPrdWorkflow } from '@goose-hub/core/workflows/grill-and-prd.js';
import type { PRDOutput } from '@goose-hub/skills/write-prd/schema.js';
import { getMaxParallelAgents, withParallelLock } from './dispatch-lock.js';
import { REPO_ROOT } from './slice-url.js';
import { getSourceForSlug } from './source.js';

const GRILL_QUESTION_MARKER = '<!-- factory:grill-question -->';
const LEGACY_PRD_MARKER = '<!-- factory:prd -->';
const SYSTEM_MARKER = '<!-- factory:system -->';
const CHILD_ISSUES_MARKER = '## Child issues';
/**
 * Build the `priorReplies` array for grill-and-prd from issue comments.
 * Agent messages: grill questions (<!-- factory:grill-question -->). System-marker,
 * legacy PRD marker, and child-issues comments are excluded as noise.
 */
function buildPriorReplies(
  comments: ReadonlyArray<{ body: string }>,
): Array<{ role: 'user' | 'agent'; content: string }> {
  return comments
    .filter(
      (c) =>
        !c.body.startsWith(SYSTEM_MARKER) &&
        !c.body.startsWith(LEGACY_PRD_MARKER) &&
        !c.body.startsWith(CHILD_ISSUES_MARKER),
    )
    .map((c) => ({
      role: c.body.startsWith(GRILL_QUESTION_MARKER) ? ('agent' as const) : ('user' as const),
      content: c.body,
    }));
}

/**
 * Run the grill-and-prd workflow for a single issue. Drops duplicate
 * triggers via parallel-lock. Webhook fires this when the issue lands in
 * `factory:grilling`; the rejectPRD handler fires it after returning a
 * rejected PRD to grilling.
 */
export async function dispatchGrillAndPrd(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(
    slug,
    issueNumber,
    'dispatchGrillAndPrd',
    dispatchGrillAndPrd,
    async () => {
      const source = await getSourceForSlug(slug);
      if (source == null) {
        logger.error('dispatchGrillAndPrd: no source for slug', { slug });
        return;
      }
      const item = await source.getItem(issueNumber.toString());
      if (item.state !== 'factory:grilling') {
        logger.info('dispatchGrillAndPrd: state already advanced, skipping', {
          slug,
          issueNumber,
          state: item.state,
        });
        return;
      }
      const comments = await source.listComments(issueNumber.toString());
      const priorReplies = buildPriorReplies(comments);
      const mockGrillDeps =
        process.env.MOCK_AGENTS === 'true'
          ? {
              createWorktreeImpl: (_repo: string, _runId: string) => '/mock/worktree',
              cleanupWorktreeImpl: (_runId: string) => undefined,
            }
          : undefined;
      await runGrillAndPrdWorkflow({
        workItem: item,
        stateSource: source,
        projectId: slug,
        priorReplies,
        deps: { repoRoot: REPO_ROOT, ...(mockGrillDeps ?? {}) },
      });
    },
  );
}

/**
 * Retry write-prd directly, skipping re-grilling. Used when an issue is stuck
 * in factory:prd-drafting after a failed or incomplete write-prd run. Grill
 * context (refinedIntent) is recovered from the grill.completed event in the
 * event store; priorReplies are rebuilt from issue comments so the PRD writer
 * has the full Q&A history.
 */
export async function dispatchRetryWritePrd(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(
    slug,
    issueNumber,
    'dispatchRetryWritePrd',
    dispatchRetryWritePrd,
    async () => {
      const source = await getSourceForSlug(slug);
      if (source == null) {
        logger.error('dispatchRetryWritePrd: no source for slug', { slug });
        return;
      }
      const item = await source.getItem(issueNumber.toString());
      if (item.state !== 'factory:prd-drafting') {
        logger.info('dispatchRetryWritePrd: state already advanced, skipping', {
          slug,
          issueNumber,
          state: item.state,
        });
        return;
      }
      const comments = await source.listComments(issueNumber.toString());
      const priorReplies = buildPriorReplies(comments);
      await runGrillAndPrdWorkflow({
        workItem: item,
        stateSource: source,
        projectId: slug,
        priorReplies,
        skipGrill: true,
        deps: { repoRoot: REPO_ROOT },
      });
    },
  );
}

/**
 * Re-run write-prd with prior PRD + human concerns (revise path).
 * Drops duplicate triggers via parallel-lock. State stays prd-review.
 *
 * Note: intentionally does not enqueue on cap-full (user-triggered, not
 * webhook-driven) and does not drain on release.
 */
export async function dispatchRevisePrd(
  slug: string,
  issueNumber: number,
  priorPrd: PRDOutput | undefined,
  humanConcerns: string[],
): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchRevisePrd: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
  try {
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchRevisePrd: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    const comments = await source.listComments(issueNumber.toString());
    const priorReplies = buildPriorReplies(comments);
    await runGrillAndPrdWorkflow({
      workItem: item,
      stateSource: source,
      projectId: slug,
      priorReplies,
      priorPrd,
      humanConcerns,
      deps: { repoRoot: REPO_ROOT },
    });
  } finally {
    parallelLock.release(slug, issueNumber);
  }
}

/**
 * Run the decompose-prd workflow for a single issue. Drops duplicate
 * triggers via parallel-lock. Webhook fires this when the issue lands
 * in `factory:decomposing`. This is now a manual/backcompat path; PRD
 * approval routes the parent issue to `factory:dev-ready`.
 */
export async function dispatchDecomposePrd(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(
    slug,
    issueNumber,
    'dispatchDecomposePrd',
    dispatchDecomposePrd,
    async () => {
      const source = await getSourceForSlug(slug);
      if (source == null) {
        logger.error('dispatchDecomposePrd: no source for slug', { slug });
        return;
      }
      const item = await source.getItem(issueNumber.toString());
      if (item.state !== 'factory:decomposing') {
        logger.info('dispatchDecomposePrd: state already advanced, skipping', {
          slug,
          issueNumber,
          state: item.state,
        });
        return;
      }
      const prdOutput = await resolveLatestPrd({
        projectId: slug,
        workItemId: item.id,
      });
      if (prdOutput == null) {
        logger.error('dispatchDecomposePrd: no PRD draft found', { slug, issueNumber });
        await source.comment(
          issueNumber.toString(),
          'decompose-prd: no PRD draft found on this issue. Returning to needs-human.',
        );
        await transitionAndEmitState({
          source,
          projectId: slug,
          itemId: issueNumber.toString(),
          workItemId: item.id,
          from: 'factory:decomposing',
          to: 'factory:needs-human',
          by: 'decompose-prd',
          mode: 'forced',
          reason: 'no PRD draft found',
        });
        return;
      }
      if (prdOutput.prd == null) {
        logger.error('dispatchDecomposePrd: PRD draft could not be parsed', {
          slug,
          issueNumber,
          source: prdOutput.source,
        });
        await source.comment(
          issueNumber.toString(),
          'decompose-prd: PRD draft could not be parsed. Returning to needs-human.',
        );
        await transitionAndEmitState({
          source,
          projectId: slug,
          itemId: issueNumber.toString(),
          workItemId: item.id,
          from: 'factory:decomposing',
          to: 'factory:needs-human',
          by: 'decompose-prd',
          mode: 'forced',
          reason: 'PRD draft could not be parsed',
        });
        return;
      }
      await runDecomposePrdWorkflow({
        workItem: item,
        prdOutput: prdOutput.prd,
        stateSource: source,
        projectId: slug,
      });
    },
  );
}
