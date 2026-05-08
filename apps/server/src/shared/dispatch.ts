import { join } from 'node:path';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { filterEligibleByDependencies } from '@goose-hub/core/projects/dependency-scheduler.js';
import { parallelLock } from '@goose-hub/core/projects/parallel-lock.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { createProjectAwareTargetSource } from '@goose-hub/core/state-source/dependency-resolver.js';
import { parseAcceptanceCriteria } from '../domains/issues/parse-acceptance.js';
import { runRetroForItem } from '../domains/workflows/retro-batch.js';
import { maybeFireSprintReview } from '../domains/workflows/sprint-review-trigger.js';
import { runTriageBatch } from '../domains/workflows/triage-batch.js';
import { getProject } from './projects.js';
import { getSourceForSlug } from './source.js';

const _triageBatchInFlight = new Set<string>();
const _triageBatchPending = new Set<string>();

async function getMaxParallelAgents(slug: string): Promise<number> {
  const cfg = await getProject(slug);
  return cfg?.budgets.maxParallelAgents ?? 1;
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
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchInvestigate: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
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
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchInvestigate: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    const mockInvestigateDeps: Record<string, unknown> | undefined =
      process.env.MOCK_AGENTS === 'true'
        ? {
            createWorktreeImpl: () => '/mock/worktree',
            prewarmWorktreeImpl: () => undefined,
          }
        : undefined;
    await runInvestigateWorkflow(item, source, slug, REPO_ROOT, mockInvestigateDeps);
  } finally {
    parallelLock.release(slug, issueNumber);
  }

  // Chain to investigation-complete routing outside the lock. In production the
  // GitHub label-change webhook fires dispatchForLabel('factory:investigation-complete')
  // instead; in MOCK_SOURCE mode there are no webhooks so we chain explicitly.
  // Idempotency is enforced by the state check inside dispatchInvestigationComplete.
  await dispatchInvestigationComplete(slug, issueNumber);
}

/** Run the M7 fix-issue workflow for a single issue (#183). Drops duplicate triggers for the same issue. */
export async function dispatchFixIssue(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchFixIssue: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
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

    // Dependency gate: skip dispatch if any dep is open or unregistered.
    // filterEligibleByDependencies applies schedule:blocked-by and needs-human
    // labels as side-effects, so we only need to check eligible.length here.
    const depProjectConfig = await getProject(slug);
    if (depProjectConfig != null) {
      const fetchTarget = await createProjectAwareTargetSource();
      const { eligible } = await filterEligibleByDependencies([item], {
        currentRepo: depProjectConfig.source.repo,
        fetchTarget,
        source,
      });
      if (eligible.length === 0) {
        logger.info('dispatchFixIssue: item blocked by deps, skipping', {
          slug,
          issueNumber,
        });
        return;
      }
    }

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
            prewarmWorktreeImpl: () => undefined,
            cleanupWorktreeImpl: () => undefined,
            resolveWorktreeHeadShaImpl: () => 'mock-sha-abc123',
            orchestratorCommitAllImpl: () => 'mock-commit-sha',
          }
        : undefined;

    await runFixIssueWorkflow(item, source, slug, REPO_ROOT, mockDeps);
  } finally {
    parallelLock.release(slug, issueNumber);
  }
}

/** Run the merge conflict resolution workflow for a single issue. Drops duplicate triggers. */
export async function dispatchResolveConflict(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchResolveConflict: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
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
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchResolveConflict: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    const mockConflictDeps: Record<string, unknown> | undefined =
      process.env.MOCK_SOURCE === 'true'
        ? {
            mergePRImpl: () => Promise.resolve({ sha: 'mock-sha-merged', merged: true }),
            gitExecImpl: () => '',
          }
        : undefined;
    await runResolveConflictWorkflow(item, source, slug, REPO_ROOT, mockConflictDeps);
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
    parallelLock.release(slug, issueNumber);
  }
}

/** Run the QA holdout workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchQa(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchQa: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
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
  } finally {
    parallelLock.release(slug, issueNumber);
  }
}

/** Run the fix-feedback workflow for a single issue. Drops duplicate triggers. */
export async function dispatchNeedsFix(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchNeedsFix: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runFixFeedbackWorkflow } = (await import(
      new URL('../../../../slices/fix-feedback/workflow.js', import.meta.url).href
    )) as {
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
  } finally {
    parallelLock.release(slug, issueNumber);
  }
}

/**
 * Auto-transition from qa-failed based on retry logic.
 * QA already applied shouldEscalateQa — if we reach this label, retries
 * remain. Transition qa-failed → needs-fix and dispatch fix-feedback.
 */
async function dispatchQaFailed(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchQaFailed: parallel-lock rejected (in-flight or at cap)', {
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

    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:qa-failed', to: 'factory:needs-fix', by: 'orchestrator' },
    });

    logger.info('dispatchQaFailed: transitioned to needs-fix, dispatching fix-feedback', {
      slug,
      issueNumber,
    });
  } finally {
    parallelLock.release(slug, issueNumber);
  }

  // Fire fix-feedback outside the in-flight guard so needs-fix can also
  // be triggered independently (e.g. review-failed path in the future).
  await dispatchNeedsFix(slug, issueNumber);
}

/** Run the Review holdout workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchReview(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchReview: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
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
    parallelLock.release(slug, issueNumber);
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
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchRetro: parallel-lock rejected (in-flight or at cap)', {
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
    parallelLock.release(slug, issueNumber);
  }
}

/**
 * Auto-transition from investigation-complete based on confidence.
 * Low confidence → gate-pending (human review required).
 * Medium/high → dev-ready (proceed automatically).
 */
async function dispatchInvestigationComplete(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchInvestigationComplete: parallel-lock rejected (in-flight or at cap)', {
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
    parallelLock.release(slug, issueNumber);
  }
}

/**
 * Handles terminal labels (factory:archived, factory:rejected) that bypass the
 * retro path. Fetches the issue's milestone and fires maybeFireSprintReview so
 * that the sprint-review trigger runs even when an issue is archived or rejected
 * without going through retrospective (PLAN §12.6).
 */
async function dispatchTerminalLabel(slug: string, issueNumber: number): Promise<void> {
  const source = await getSourceForSlug(slug);
  if (source == null) {
    logger.error('dispatchTerminalLabel: no source for slug', { slug, issueNumber });
    return;
  }
  const item = await source.getItem(issueNumber.toString());
  const milestoneNumber = item.milestoneId != null ? Number(item.milestoneId) : null;
  const milestoneTitle = item.milestoneTitle ?? null;
  if (milestoneNumber == null || Number.isNaN(milestoneNumber) || milestoneTitle == null) {
    logger.info('dispatchTerminalLabel: no milestoneId, skipping sprint-review check', {
      slug,
      issueNumber,
    });
    return;
  }
  // Fire-and-forget; errors logged inside maybeFireSprintReview.
  void maybeFireSprintReview(slug, milestoneNumber, milestoneTitle, source);
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
  if (labelName === 'factory:qa-failed') {
    await dispatchQaFailed(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:needs-fix') {
    await dispatchNeedsFix(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:grilling') {
    await dispatchGrillAndPrd(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:decomposing') {
    await dispatchDecomposePrd(slug, issueNumber);
    return;
  }
  // Terminal labels that bypass retro — check for sprint-review eligibility.
  if (labelName === 'factory:archived' || labelName === 'factory:rejected') {
    await dispatchTerminalLabel(slug, issueNumber);
    return;
  }
  logger.info('dispatchForLabel: no workflow for label', { slug, labelName });
}

// ─── M13 Discover Lane dispatchers ────────────────────────────────────────────

const PRD_MARKER = '<!-- factory:prd -->';
const GRILL_QUESTION_MARKER = '<!-- factory:grill-question -->';
const SYSTEM_MARKER = '<!-- factory:system -->';
const CHILD_ISSUES_MARKER = '## Child issues';
const PRD_JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/;

/**
 * Extract the PRDOutput JSON from the latest `<!-- factory:prd -->` marker
 * comment. Returns `null` if no marker comment exists or the JSON fence
 * fails to parse. The decompose-prd workflow validates the parsed shape
 * against `DecomposeOutputSchema`'s upstream `PRDOutputSchema` itself.
 */
function extractPrdFromComments(
  comments: ReadonlyArray<{ body: string; createdAt: string }>,
): unknown {
  const matches = comments.filter((c) => c.body.startsWith(PRD_MARKER));
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const fence = sorted[sorted.length - 1].body.match(PRD_JSON_FENCE_RE);
  if (fence == null) return null;
  try {
    return JSON.parse(fence[1]);
  } catch {
    return null;
  }
}

/**
 * Build the `priorReplies` array for grill-and-prd from issue comments.
 * Agent questions carry the `<!-- factory:grill-question -->` prefix; every
 * other comment is treated as a user reply. PRD-marker, system-marker, and
 * child-issues comments are filtered out so they don't bleed into the grill
 * conversation.
 */
function buildPriorReplies(
  comments: ReadonlyArray<{ body: string }>,
): Array<{ role: 'user' | 'agent'; content: string }> {
  return comments
    .filter(
      (c) =>
        !c.body.startsWith(PRD_MARKER) &&
        !c.body.startsWith(SYSTEM_MARKER) &&
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
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchGrillAndPrd: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
  try {
    const { runGrillAndPrdWorkflow } = await import('@goose-hub/core/workflows/grill-and-prd.js');
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
    await runGrillAndPrdWorkflow({
      workItem: item,
      stateSource: source,
      projectId: slug,
      priorReplies,
    });
  } finally {
    parallelLock.release(slug, issueNumber);
  }
}

/**
 * Run the decompose-prd workflow for a single issue. Drops duplicate
 * triggers via parallel-lock. Webhook fires this when the issue lands
 * in `factory:decomposing`; the approvePRD handler fires it after the
 * human approves the PRD comment.
 */
export async function dispatchDecomposePrd(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.warn('dispatchDecomposePrd: parallel-lock rejected (in-flight or at cap)', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    return;
  }
  try {
    const { runDecomposePrdWorkflow } = await import('@goose-hub/core/workflows/decompose-prd.js');
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
    const comments = await source.listComments(issueNumber.toString());
    const prdOutput = extractPrdFromComments(comments);
    if (prdOutput == null) {
      logger.error('dispatchDecomposePrd: no PRD marker comment found', { slug, issueNumber });
      await source.comment(
        issueNumber.toString(),
        'decompose-prd: no PRD comment found on this issue. Returning to needs-human.',
      );
      await source.forceState(issueNumber.toString(), 'factory:needs-human');
      return;
    }
    await runDecomposePrdWorkflow({
      workItem: item,
      prdOutput,
      stateSource: source,
      projectId: slug,
    });
  } finally {
    parallelLock.release(slug, issueNumber);
  }
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
  'factory:qa-failed': { targetState: 'factory:needs-fix', dispatch: dispatchNeedsFix },
  'factory:needs-fix': { targetState: 'factory:needs-fix', dispatch: dispatchNeedsFix },
  // Discover lane
  'factory:grilling': { targetState: 'factory:grilling', dispatch: dispatchGrillAndPrd },
  // factory:gate-pending is lane-agnostic (it can originate from grilling or
  // other human-gate situations) and has no single canonical resume target, so
  // it is intentionally omitted here. Human triage is required.
  'factory:prd-drafting': { targetState: 'factory:grilling', dispatch: dispatchGrillAndPrd },
  'factory:decomposing': { targetState: 'factory:decomposing', dispatch: dispatchDecomposePrd },
};

// Skills that belong to the discover lane — used to detect whether a
// factory:needs-human escape originated from grilling so resume can route back.
const DISCOVER_LANE_SKILLS = new Set(['grill-me', 'write-prd', 'advise-on-prd', 'grill-and-prd']);

/**
 * Resume an orphaned or stalled run. Looks up the issue's current state,
 * forces it back to the canonical trigger state for that workflow (e.g.
 * factory:in-progress → factory:dev-ready), then re-dispatches. Uses
 * forceState rather than transitionState because recovery transitions are
 * not always legal in the normal workflow graph.
 *
 * factory:needs-human is handled specially: event history is inspected to
 * determine which lane the failure originated from so resume can route back
 * to the correct workflow.
 */
export async function dispatchResumeIssue(slug: string, issueNumber: number): Promise<void> {
  if (parallelLock.isInFlight(slug, issueNumber)) {
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

  // Special-case: needs-human is lane-agnostic. Inspect event history to find
  // which skill last failed and route to the appropriate resume workflow.
  if (fromState === 'factory:needs-human') {
    const allEvents = eventStore.replay({ projectId: slug, workItemId });
    const lastRunFailed = [...allEvents].reverse().find((e) => e.kind === 'agent.run-failed');
    const failedSkill = (lastRunFailed?.payload as { skill?: string } | undefined)?.skill;

    if (failedSkill != null && DISCOVER_LANE_SKILLS.has(failedSkill)) {
      logger.info('dispatchResumeIssue: needs-human from discover lane, resuming grilling', {
        slug,
        issueNumber,
        failedSkill,
      });
      await source.forceState(workItemId, 'factory:grilling');
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'state.transitioned',
        payload: { from: fromState, to: 'factory:grilling', by: 'resume' },
      });
      await dispatchGrillAndPrd(slug, issueNumber);
      return;
    }

    logger.warn(
      'dispatchResumeIssue: needs-human with no discover-lane failure, cannot auto-resume',
      {
        slug,
        issueNumber,
        failedSkill,
      },
    );
    return;
  }

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
