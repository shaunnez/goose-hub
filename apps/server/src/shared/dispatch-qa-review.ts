import {
  acceptanceCriteriaToVerifyCommands,
  parseIssueBodyVerifyCommands,
} from '@goose-hub/core/acceptance-contracts/issue-body.js';
import { resolveAcceptanceContract } from '@goose-hub/core/acceptance-contracts/resolver.js';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { getUseMultiAgentPipeline } from '@goose-hub/core/db/repositories/project-settings.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { classifyQaFailureActionability } from '@goose-hub/core/qa/actionability.js';
import { runRetroForItem } from '../domains/workflows/retro-batch.js';
import { withParallelLock } from './dispatch-lock.js';
import { getProject } from './projects.js';
import { REPO_ROOT, sliceUrl } from './slice-url.js';
import { getSourceForSlug } from './source.js';

type VerifyCommand = {
  criterionId: string;
  checkId: string;
  ac: string;
  command: string;
  expectedExitCodes: number[];
  outputExpectation?: {
    mode: 'exact' | 'contains' | 'regex';
    value: string;
  };
  evidenceExpectation?:
    | { type: 'exit-code' }
    | { type: 'vitest-json'; suite?: string; testName?: string; expectedStatus: 'passed' };
  timeoutMs?: number;
};

function latestNonActionableQaFailure(
  workItemId: string,
): { reason: string; feedback: string } | null {
  const event = eventStore
    .replay({ workItemId })
    .slice()
    .reverse()
    .find((entry) => {
      if (entry.kind === 'qa.verification-blocked') return true;
      if (entry.kind !== 'qa.completed') return false;
      return (entry.payload as { verdict?: string } | null)?.verdict !== 'pass';
    });
  if (event == null) return null;
  const payload = event.payload as Record<string, unknown>;
  if (event.kind === 'qa.verification-blocked') {
    const reason = typeof payload.reason === 'string' ? payload.reason : 'verification-blocked';
    return { reason, feedback: reason };
  }
  if (payload.failureCategory === 'verification-infrastructure') {
    return {
      reason: 'verification-infrastructure',
      feedback:
        typeof payload.reason === 'string'
          ? payload.reason
          : 'QA failed in verification infrastructure before product assertions could run.',
    };
  }
  const actionability =
    typeof payload.qaActionability === 'object' && payload.qaActionability != null
      ? (payload.qaActionability as {
          actionable?: boolean;
          reason?: string;
          classification?: string;
        })
      : classifyQaFailureActionability(
          payload as Parameters<typeof classifyQaFailureActionability>[0],
        );
  if (actionability.actionable !== false) return null;
  return {
    reason: actionability.classification ?? 'non-actionable-qa-failure',
    feedback: actionability.reason ?? 'QA failure is not actionable for fix-feedback.',
  };
}

function mergeVerifyCommands(...groups: VerifyCommand[][]): VerifyCommand[] {
  const merged = new Map<string, VerifyCommand>();
  for (const command of groups.flat()) {
    const key = JSON.stringify({
      criterionId: command.criterionId,
      checkId: command.checkId,
      ac: command.ac,
      command: command.command,
      expectedExitCodes: command.expectedExitCodes,
      outputExpectation: command.outputExpectation,
      evidenceExpectation: command.evidenceExpectation,
      timeoutMs: command.timeoutMs,
    });
    if (!merged.has(key)) merged.set(key, command);
  }
  return [...merged.values()];
}

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
          executableChecks?: VerifyCommand[];
          acceptanceContract?: unknown;
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
    const acceptanceContract = resolveAcceptanceContract({
      projectId: slug,
      workItemId: item.id,
      issueBody: item.body,
    });
    const executableChecks = mergeVerifyCommands(
      acceptanceCriteriaToVerifyCommands(acceptanceContract?.criteria ?? []),
      parseIssueBodyVerifyCommands(item.body ?? ''),
    );
    const qaRunTests = process.env.MOCK_SOURCE === 'true' ? () => Promise.resolve(null) : undefined;
    await runQaWorkflow(item, source, slug, item.repoRef ?? slug, {
      executableChecks,
      acceptanceContract: acceptanceContract ?? undefined,
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
    const mockDeps: Record<string, unknown> | undefined =
      process.env.MOCK_AGENTS === 'true' || process.env.MOCK_OPEN_PR === 'true'
        ? {
            orchestratorCommitAllImpl: () => ({
              status: 'committed',
              sha: 'mock-fix-feedback-sha',
            }),
            orchestratorPushBranchImpl: () => undefined,
          }
        : undefined;
    await runFixFeedbackWorkflow(item, source, slug, item.repoRef ?? slug, mockDeps);
  });
}

/**
 * Auto-transition from qa-failed based on retry logic.
 * QA already applied shouldEscalateQa — if we reach this label, retries
 * remain. Transition qa-failed → needs-fix and dispatch fix-feedback.
 */
export async function dispatchQaFailed(slug: string, issueNumber: number): Promise<void> {
  let shouldRunFixFeedback = false;
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

    const workItemId = item.id;
    const nonActionable = latestNonActionableQaFailure(workItemId);
    if (nonActionable != null) {
      await source.comment(
        item.externalId,
        buildAgentComment(
          'QA',
          'Verification Blocked',
          'QA failed without issue-local repair evidence, so fix-feedback will not run.',
          [nonActionable.feedback],
        ),
      );
      await source.transitionState(workItemId, 'factory:qa-failed', 'factory:needs-human');
      emitStateTransitionEvent({
        projectId: slug,
        workItemId,
        from: 'factory:qa-failed',
        to: 'factory:needs-human',
        by: 'orchestrator',
        extraPayload: { reason: nonActionable.reason },
      });
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'agent.fix-feedback-skipped',
        payload: {
          reason: nonActionable.reason,
          sourceFeedback: nonActionable.feedback,
          sourceFailureKind: 'qa',
        },
      });
      logger.info('dispatchQaFailed: non-actionable QA failure routed to needs-human', {
        slug,
        issueNumber,
        reason: nonActionable.reason,
      });
      return;
    }

    await source.transitionState(workItemId, 'factory:qa-failed', 'factory:needs-fix');

    emitStateTransitionEvent({
      projectId: slug,
      workItemId,
      from: 'factory:qa-failed',
      to: 'factory:needs-fix',
      by: 'orchestrator',
    });

    logger.info(
      'dispatchQaFailed: transitioned to needs-fix; fix-feedback will run on a future tick',
      {
        slug,
        issueNumber,
      },
    );
    shouldRunFixFeedback = true;
  });
  if (shouldRunFixFeedback) {
    await dispatchNeedsFix(slug, issueNumber);
  }
}
