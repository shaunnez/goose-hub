import { logger } from '@goose-hub/core/logger.js';
import { getUseMultiAgentPipeline } from '@goose-hub/core/db/repositories/project-settings.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { runRetroForItem } from '../domains/workflows/retro-batch.js';
import { parseAcceptanceCriteria } from '../domains/issues/parse-acceptance.js';
import { getProject } from './projects.js';
import { REPO_ROOT, sliceUrl } from './slice-url.js';
import { getSourceForSlug } from './source.js';
import { withParallelLock } from './dispatch-lock.js';

/** Run the QA holdout workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchQa(slug: string, issueNumber: number): Promise<void> {
  const projectForFlag = await getProject(slug);
  const useMultiAgent =
    projectForFlag != null ? getUseMultiAgentPipeline(projectForFlag.id) : false;
  logger.info('dispatchQa: pipeline flag', {
    slug,
    issueNumber,
    useMultiAgentPipeline: useMultiAgent,
  });
  await withParallelLock(slug, issueNumber, 'dispatchQa', dispatchQa, async () => {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runQaWorkflow } = (await import(sliceUrl('qa'))) as {
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
          runTests?: (() => Promise<null>) | undefined;
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
    const qaRunTests = process.env.MOCK_SOURCE === 'true' ? () => Promise.resolve(null) : undefined;
    await runQaWorkflow(item, source, slug, item.repoRef ?? slug, {
      verifyCommands,
      runTests: qaRunTests,
    });
  });
}

/** Run the Review holdout workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchReview(slug: string, issueNumber: number): Promise<void> {
  const projectForFlag = await getProject(slug);
  const useMultiAgent =
    projectForFlag != null ? getUseMultiAgentPipeline(projectForFlag.id) : false;
  logger.info('dispatchReview: pipeline flag', {
    slug,
    issueNumber,
    useMultiAgentPipeline: useMultiAgent,
  });
  await withParallelLock(slug, issueNumber, 'dispatchReview', dispatchReview, async () => {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runReviewWorkflow, runConvergentReviewWorkflow } = (await import(
      sliceUrl('review')
    )) as {
      runReviewWorkflow: (
        item: unknown,
        source: unknown,
        projectSlug: string,
        targetRepo: string,
      ) => Promise<unknown>;
      runConvergentReviewWorkflow: (
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
    if (useMultiAgent) {
      await runConvergentReviewWorkflow(item, source, slug, item.repoRef ?? slug);
    } else {
      await runReviewWorkflow(item, source, slug, item.repoRef ?? slug);
    }
  });
}

/**
 * Run the retrospective workflow for a single issue. Drops concurrent
 * duplicates via the in-flight guard, AND skips items whose state already
 * advanced past factory:retrospecting — retro is triggered both directly
 * from approveIssue and via the factory:retrospecting label webhook, so
 * sequential duplicate triggers must no-op once the workflow has run.
 */
export async function dispatchRetro(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(slug, issueNumber, 'dispatchRetro', dispatchRetro, async () => {
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
  });
}

/** Run the fix-feedback workflow for a single issue. Drops duplicate triggers. */
export async function dispatchNeedsFix(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(slug, issueNumber, 'dispatchNeedsFix', dispatchNeedsFix, async () => {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runFixFeedbackWorkflow } = (await import(sliceUrl('fix-feedback'))) as {
      runFixFeedbackWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        targetRepo: string,
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchNeedsFix: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    if (item.state !== 'factory:needs-fix') {
      logger.info('dispatchNeedsFix: state already moved, skipping', {
        slug,
        issueNumber,
        state: item.state,
      });
      return;
    }
    await runFixFeedbackWorkflow(item, source, slug, item.repoRef ?? slug);
  });
}

/**
 * Auto-transition from qa-failed based on retry logic.
 * QA already applied shouldEscalateQa — if we reach this label, retries
 * remain. Transition qa-failed → needs-fix and dispatch fix-feedback.
 */
export async function dispatchQaFailed(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(slug, issueNumber, 'dispatchQaFailed', dispatchQaFailed, async () => {
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchQaFailed: no source for slug', { slug });
      return;
    }

    const item = await source.getItem(issueNumber.toString());
    if (item.state !== 'factory:qa-failed') {
      logger.info('dispatchQaFailed: state already moved', {
        slug,
        issueNumber,
        state: item.state,
      });
      return;
    }

    const workItemId = `github:${source.repoRef}#${issueNumber}`;
    await source.transitionState(workItemId, 'factory:qa-failed', 'factory:needs-fix');

    emitStateTransitionEvent({
      projectId: slug,
      workItemId,
      from: 'factory:qa-failed',
      to: 'factory:needs-fix',
      by: 'orchestrator',
    });

    logger.info('dispatchQaFailed: transitioned to needs-fix, dispatching fix-feedback', {
      slug,
      issueNumber,
    });

    // Fire fix-feedback outside the in-flight guard so needs-fix can also
    // be triggered independently (e.g. review-failed path in the future).
    return () => dispatchNeedsFix(slug, issueNumber);
  });
}
