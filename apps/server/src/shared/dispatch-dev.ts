import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { getUseMultiAgentPipeline } from '@goose-hub/core/db/repositories/project-settings.js';
import { getEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { filterEligibleByDependencies } from '@goose-hub/core/projects/dependency-scheduler.js';
import { firstProjectRepository } from '@goose-hub/core/projects/repositories.js';
import { createProjectAwareTargetSource } from '@goose-hub/core/state-source/dependency-resolver.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import type { InvestigateOutput } from '@goose-hub/skills/investigate/schema.js';
import { EngineeringSpecSchema } from '@goose-hub/skills/spec-author/schema.js';
import { validateEngineeringSpec } from '@goose-hub/skills/spec-author/validate.js';
import { withParallelLock } from './dispatch-lock.js';
import { getProject } from './projects.js';
import { REPO_ROOT, sliceUrl } from './slice-url.js';
import { getSourceForSlug } from './source.js';

type InvCompletePayload = {
  investigate?: InvestigateOutput;
  investigationRunId?: string;
  investigationPlan?: {
    mode?: 'single' | 'swarm';
    selectedWave1Scouts?: string[];
    wave2Needed?: boolean;
  };
};

function primaryRepoRef(project: ProjectConfig): string {
  const source = project.source as {
    kind?: string;
    type?: string;
    repo?: string;
    integrations?: { github?: { repos?: string[] } };
  };
  if ((source.kind === 'github' || source.type === 'github') && typeof source.repo === 'string') {
    return source.repo;
  }
  return firstProjectRepository(project)?.repoRef ?? `local:${project.id}`;
}

function hasEquivalentInvestigationCompleteTransition(
  events: Array<{ kind: string; payload: unknown }>,
  targetState: 'factory:gate-pending' | 'factory:dev-ready',
): boolean {
  let latestInvestigationIndex = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.kind === 'agent.investigation-complete') {
      latestInvestigationIndex = i;
      break;
    }
  }
  if (latestInvestigationIndex === -1) return false;

  return events.slice(latestInvestigationIndex + 1).some((event) => {
    if (event.kind !== 'state.transitioned') return false;
    const payload = event.payload as { from?: unknown; to?: unknown; by?: unknown } | null;
    return (
      payload?.from === 'factory:investigation-complete' &&
      payload.to === targetState &&
      payload.by === 'orchestrator'
    );
  });
}

function hasAcceptanceContractAfterLatestInvestigation(events: Array<{ kind: string }>): boolean {
  let latestInvestigationIndex = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.kind === 'agent.investigation-complete') {
      latestInvestigationIndex = i;
      break;
    }
  }
  if (latestInvestigationIndex === -1) return false;
  return events
    .slice(latestInvestigationIndex + 1)
    .some((event) => event.kind === 'acceptance.contract-authored');
}

/**
 * For bugs in the M19 pipeline: read the latest investigation event and decide
 * whether the fix warrants the full spec-author → parallel-build pipeline or
 * whether a single developer agent (legacy) is sufficient.
 *
 * Simple = ≤3 non-test key files, high confidence.
 * When no investigation exists, defaults to legacy (fail-safe).
 */
function resolveFixIssuePipelineForBug(
  projectId: string,
  workItemId: string,
): 'spec-author' | 'legacy' {
  const [latestInv] = eventStore.replay({
    projectId,
    workItemId,
    kind: 'agent.investigation-complete',
    order: 'desc',
    limit: 1,
  });
  if (latestInv == null) return 'legacy';
  const investigate = (latestInv.payload as InvCompletePayload).investigate;
  if (investigate == null) return 'legacy';
  const investigationPlan = (latestInv.payload as InvCompletePayload).investigationPlan;
  const plannerLocalized =
    investigationPlan?.mode === 'single' ||
    (investigationPlan?.mode === 'swarm' &&
      investigationPlan.wave2Needed === false &&
      (investigationPlan.selectedWave1Scouts?.length ?? 0) <= 3);
  // Test files are co-changed with their source; exclude from complexity count.
  const nonTestFiles = investigate.keyFiles.filter((f) => !/\.(test|spec)\.[jt]sx?$/.test(f.path));
  return nonTestFiles.length <= 3 &&
    investigate.confidence === 'high' &&
    (investigationPlan == null || plannerLocalized)
    ? 'legacy'
    : 'spec-author';
}

async function readRoutingLabels(input: {
  source: StateSource;
  item: WorkItem;
  slug: string;
  issueNumber: number;
}): Promise<string[]> {
  if (input.source.listLabels == null) return [];
  try {
    return await input.source.listLabels(input.item.externalId);
  } catch (err) {
    logger.warn('dispatchFixIssue: listLabels failed, continuing with default routing', {
      slug: input.slug,
      issueNumber: input.issueNumber,
      itemId: input.item.id,
      error: String(err),
    });
    return [];
  }
}

async function recordLegacyFixIssueStartupFailure(input: {
  source: StateSource;
  item: WorkItem;
  slug: string;
  issueNumber: number;
  error: Error;
}): Promise<void> {
  logger.error('dispatchFixIssue: legacy fix-issue failed before in-progress transition', {
    slug: input.slug,
    issueNumber: input.issueNumber,
    itemId: input.item.id,
    error: input.error.message,
  });
  eventStore.appendEvent({
    projectId: input.slug,
    workItemId: input.item.id,
    kind: 'agent.run-failed',
    payload: {
      skill: 'implement',
      workflowSkill: 'fix-issue',
      error: input.error.message,
      reason: 'legacy fix-issue failed before in-progress transition',
    },
  });

  try {
    await input.source.comment(
      input.item.externalId,
      buildAgentComment(
        'Dev',
        'Failed',
        'Fix-issue failed before implementation could start — escalating to needs-human',
        [`Error: ${input.error.message}`],
      ),
    );
  } catch (commentErr) {
    logger.warn('dispatchFixIssue: failed to comment on pre-start failure', {
      slug: input.slug,
      issueNumber: input.issueNumber,
      error: String(commentErr),
    });
  }

  let current: WorkItem;
  try {
    current = await input.source.getItem(input.issueNumber.toString());
  } catch (readErr) {
    logger.warn('dispatchFixIssue: failed to re-read issue after pre-start failure', {
      slug: input.slug,
      issueNumber: input.issueNumber,
      error: String(readErr),
    });
    return;
  }

  if (current.state !== 'factory:dev-ready') {
    logger.info('dispatchFixIssue: pre-start failure left state unchanged by dispatcher', {
      slug: input.slug,
      issueNumber: input.issueNumber,
      state: current.state,
    });
    return;
  }

  try {
    await input.source.transitionState(
      current.externalId,
      'factory:dev-ready',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId: input.slug,
      workItemId: current.id,
      from: 'factory:dev-ready',
      to: 'factory:needs-human',
      by: 'fix-issue',
    });
  } catch (transitionErr) {
    logger.warn('dispatchFixIssue: failed to transition pre-start failure to needs-human', {
      slug: input.slug,
      issueNumber: input.issueNumber,
      error: String(transitionErr),
    });
  }
}

/** Run the investigate workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchInvestigate(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(
    slug,
    issueNumber,
    'dispatchInvestigate',
    dispatchInvestigate,
    async () => {
      // Cross-package boundary: slices/ is not a workspace package (rule 28a).
      const { runInvestigateWorkflow } = (await import(sliceUrl('investigate'))) as {
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
    },
  );
}

/**
 * Auto-transition from investigation-complete based on confidence.
 * Low confidence → gate-pending (human review required).
 * Medium/high → dev-ready (proceed automatically).
 */
export async function dispatchInvestigationComplete(
  slug: string,
  issueNumber: number,
): Promise<void> {
  await withParallelLock(
    slug,
    issueNumber,
    'dispatchInvestigationComplete',
    dispatchInvestigationComplete,
    async () => {
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
      const investigationEvents = allEvents.filter(
        (e) => e.kind === 'agent.investigation-complete',
      );
      const latest = investigationEvents.at(-1);
      const confidence =
        (latest?.payload as { investigate?: { confidence?: string } } | null)?.investigate
          ?.confidence ?? 'medium';

      const targetState = confidence === 'low' ? 'factory:gate-pending' : 'factory:dev-ready';
      if (hasEquivalentInvestigationCompleteTransition(allEvents, targetState)) {
        logger.info('dispatchInvestigationComplete: equivalent transition already emitted', {
          slug,
          issueNumber,
          targetState,
        });
        return;
      }

      const projectForFlag = await getProject(slug);
      const useMultiAgent =
        projectForFlag != null ? getUseMultiAgentPipeline(projectForFlag.id) : false;
      const usesLegacyImplementation =
        !useMultiAgent ||
        (item.type === 'bug' && resolveFixIssuePipelineForBug(slug, workItemId) === 'legacy');
      if (
        targetState === 'factory:dev-ready' &&
        usesLegacyImplementation &&
        !hasAcceptanceContractAfterLatestInvestigation(allEvents)
      ) {
        try {
          const { runAcceptanceContractWorkflow } = (await import(
            sliceUrl('acceptance-contract')
          )) as {
            runAcceptanceContractWorkflow: (
              item: unknown,
              source: unknown,
              slug: string,
              targetRepo: string,
              deps?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
          await runAcceptanceContractWorkflow(item, source, slug, item.repoRef ?? slug);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          const errorMetadata = error as Error & { runId?: unknown; personaId?: unknown };
          const runId = typeof errorMetadata.runId === 'string' ? errorMetadata.runId : undefined;
          const personaId =
            typeof errorMetadata.personaId === 'string' ? errorMetadata.personaId : undefined;
          eventStore.appendEvent({
            projectId: slug,
            workItemId,
            kind: 'agent.run-failed',
            payload: {
              skill: 'acceptance-contract',
              error: error.message,
              reason: 'legacy acceptance contract could not be authored',
            },
            ...(runId != null ? { runId } : {}),
            ...(personaId != null ? { personaId } : {}),
          });
          await source.comment(
            item.externalId,
            `Acceptance contract authoring failed before implementation. Holding at gate-pending.\n\nError: ${error.message}`,
          );
          await source.transitionState(
            workItemId,
            'factory:investigation-complete',
            'factory:gate-pending',
          );
          emitStateTransitionEvent({
            projectId: slug,
            workItemId,
            from: 'factory:investigation-complete',
            to: 'factory:gate-pending',
            by: 'acceptance-contract',
          });
          return;
        }
      }

      await source.transitionState(workItemId, 'factory:investigation-complete', targetState);

      emitStateTransitionEvent({
        projectId: slug,
        workItemId,
        from: 'factory:investigation-complete',
        to: targetState,
        by: 'orchestrator',
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

      logger.info('dispatchInvestigationComplete: transitioned', {
        slug,
        issueNumber,
        targetState,
      });
    },
  );
}

/** Run the spec-author workflow for a single issue. Drops duplicate triggers for the same issue. */
export async function dispatchSpecAuthor(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(slug, issueNumber, 'dispatchSpecAuthor', dispatchSpecAuthor, async () => {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runSpecAuthorWorkflow } = (await import(sliceUrl('spec-author'))) as {
      runSpecAuthorWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        repoRoot: string,
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchSpecAuthor: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());

    const depProjectConfig = await getProject(slug);
    if (depProjectConfig != null) {
      const fetchTarget = await createProjectAwareTargetSource();
      const { eligible } = await filterEligibleByDependencies([item], {
        currentRepo: primaryRepoRef(depProjectConfig),
        fetchTarget,
        source,
      });
      if (eligible.length === 0) {
        logger.info('dispatchSpecAuthor: item blocked by deps, skipping', { slug, issueNumber });
        return;
      }
    }

    const mockDeps: Record<string, unknown> | undefined =
      process.env.MOCK_AGENTS === 'true'
        ? { createWorktreeImpl: () => '/mock/worktree' }
        : undefined;

    await runSpecAuthorWorkflow(item, source, slug, REPO_ROOT, mockDeps);
  });
}

export async function dispatchFixIssue(slug: string, issueNumber: number): Promise<void> {
  const projectForFlag = await getProject(slug);
  const useMultiAgent =
    projectForFlag != null ? getUseMultiAgentPipeline(projectForFlag.id) : false;
  logger.info('dispatchFixIssue: pipeline flag', {
    slug,
    issueNumber,
    useMultiAgentPipeline: useMultiAgent,
  });

  if (useMultiAgent) {
    const routingSource = await getSourceForSlug(slug);
    if (routingSource == null) {
      logger.error('dispatchFixIssue: no source for slug', { slug });
      return;
    }
    const routingItem = await routingSource.getItem(issueNumber.toString());
    const routingLabels = await readRoutingLabels({
      source: routingSource,
      item: routingItem,
      slug,
      issueNumber,
    });
    if (routingLabels.includes('factory:from-prd')) {
      logger.info('dispatchFixIssue: PRD child projection → legacy single-agent path', {
        slug,
        issueNumber,
      });
    } else if (
      routingItem.type === 'bug' &&
      resolveFixIssuePipelineForBug(slug, routingItem.id) === 'legacy'
    ) {
      logger.info('dispatchFixIssue: simple bug → legacy single-agent path', {
        slug,
        issueNumber,
      });
      // fall through to legacy path
    } else {
      await dispatchSpecAuthor(slug, issueNumber);
      return;
    }
  }

  await withParallelLock(slug, issueNumber, 'dispatchFixIssue', dispatchFixIssue, async () => {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runFixIssueWorkflow } = (await import(sliceUrl('fix-issue'))) as {
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
        currentRepo: primaryRepoRef(depProjectConfig),
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
            orchestratorCommitAllImpl: () => ({
              status: 'committed',
              sha: 'mock-commit-sha',
            }),
          }
        : undefined;

    try {
      await runFixIssueWorkflow(item, source, slug, REPO_ROOT, mockDeps);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await recordLegacyFixIssueStartupFailure({
        source,
        item,
        slug,
        issueNumber,
        error,
      });
    }
  });
}

/** Run M19 parallel-implement for a spec-ready issue. Drops duplicate triggers. */
export async function dispatchParallelImplement(slug: string, issueNumber: number): Promise<void> {
  const projectForFlag = await getProject(slug);
  const projectId = projectForFlag?.id ?? slug;
  const useMultiAgent = projectForFlag != null ? getUseMultiAgentPipeline(projectId) : false;
  logger.info('dispatchParallelImplement: pipeline flag', {
    slug,
    issueNumber,
    useMultiAgentPipeline: useMultiAgent,
  });
  if (!useMultiAgent) {
    logger.info('dispatchParallelImplement: pipeline disabled, skipping', { slug, issueNumber });
    return;
  }

  await withParallelLock(
    slug,
    issueNumber,
    'dispatchParallelImplement',
    dispatchParallelImplement,
    async () => {
      // Cross-package boundary: slices/ is not a workspace package (rule 28a).
      const { runParallelImplementWorkflow } = (await import(sliceUrl('parallel-implement'))) as {
        runParallelImplementWorkflow: (
          item: unknown,
          spec: unknown,
          pipelineRunId: string,
          source: unknown,
          slug: string,
          targetRepo: string,
          deps?: Record<string, unknown>,
        ) => Promise<{ status: 'success' | 'failed'; errorReason?: string }>;
      };
      const source = await getSourceForSlug(slug);
      if (source == null) {
        logger.error('dispatchParallelImplement: no source for slug', { slug });
        return;
      }
      const item = await source.getItem(issueNumber.toString());
      if (item.state !== 'factory:spec-ready') {
        logger.info('dispatchParallelImplement: state already moved, skipping', {
          slug,
          issueNumber,
          state: item.state,
        });
        return;
      }

      const specRecord = getEngineeringSpec(slug, item.id);
      if (specRecord == null) {
        await source.comment(
          item.externalId,
          'parallel-implement: no engineering spec found for this work item. Escalating to needs-human.',
        );
        await source.transitionState(item.externalId, 'factory:spec-ready', 'factory:needs-human');
        emitStateTransitionEvent({
          projectId: slug,
          workItemId: item.id,
          from: 'factory:spec-ready',
          to: 'factory:needs-human',
          by: 'parallel-implement',
        });
        return;
      }

      const parsedSpec = EngineeringSpecSchema.safeParse(specRecord.spec);
      if (!parsedSpec.success) {
        await source.comment(
          item.externalId,
          'parallel-implement: persisted engineering spec failed schema validation. Escalating to needs-human.',
        );
        await source.transitionState(item.externalId, 'factory:spec-ready', 'factory:needs-human');
        emitStateTransitionEvent({
          projectId: slug,
          workItemId: item.id,
          from: 'factory:spec-ready',
          to: 'factory:needs-human',
          by: 'parallel-implement',
        });
        return;
      }

      const structuralValidation = validateEngineeringSpec(parsedSpec.data, {
        issueType: item.type === 'bug' ? 'bug' : 'feature',
        repoRoot: REPO_ROOT,
      });
      if (!structuralValidation.ok) {
        const errors = structuralValidation.errors
          .map((error) => `${error.rule}: ${error.message}`)
          .join('; ');
        await source.comment(
          item.externalId,
          `parallel-implement: persisted engineering spec failed structural validation. Escalating to needs-human.\n\nErrors: ${errors}`,
        );
        await source.transitionState(item.externalId, 'factory:spec-ready', 'factory:needs-human');
        emitStateTransitionEvent({
          projectId: slug,
          workItemId: item.id,
          from: 'factory:spec-ready',
          to: 'factory:needs-human',
          by: 'parallel-implement',
        });
        return;
      }

      // Inject mock deps when running under the e2e harness so filesystem/git
      // operations don't fail against non-existent worktrees.
      const parallelMockDeps: Record<string, unknown> =
        process.env.MOCK_AGENTS === 'true' || process.env.MOCK_OPEN_PR === 'true'
          ? {
              runtime: selectRuntime({ configRuntime: 'auto' }),
              openPRImpl: () =>
                Promise.resolve({
                  prNumber: 999,
                  prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
                  branch: 'factory/mock-parallel-run',
                  base: 'main',
                }),
              createIssueWorktreeImpl: (_repo: string, runId: string) => {
                const dir = join(tmpdir(), `e2e-parallel-issue-${runId}`);
                mkdirSync(dir, { recursive: true });
                return dir;
              },
              createWpWorktreeImpl: (_repo: string, runId: string, wpId: string) => {
                const dir = join(tmpdir(), `e2e-parallel-wp-${runId}-${wpId}`);
                mkdirSync(dir, { recursive: true });
                return dir;
              },
              cleanupWpWorktreesImpl: () => {},
              orchestratorCommitWpImpl: () => 'mock-commit-sha',
              revertWpChangesImpl: () => {},
              getDiffImpl: () => '',
              commitDevReviewResponseImpl: () => ({
                status: 'committed',
                sha: 'mock-dr-commit-sha',
              }),
            }
          : {};

      await source.transitionState(item.externalId, 'factory:spec-ready', 'factory:in-progress');
      emitStateTransitionEvent({
        projectId: slug,
        workItemId: item.id,
        from: 'factory:spec-ready',
        to: 'factory:in-progress',
        by: 'parallel-implement',
        runId: specRecord.pipelineRunId,
      });
      try {
        const result = await runParallelImplementWorkflow(
          item,
          parsedSpec.data,
          specRecord.pipelineRunId,
          source,
          slug,
          REPO_ROOT,
          parallelMockDeps,
        );
        if (result.status === 'success') {
          await source.transitionState(item.externalId, 'factory:in-progress', 'factory:needs-qa');
          emitStateTransitionEvent({
            projectId: slug,
            workItemId: item.id,
            from: 'factory:in-progress',
            to: 'factory:needs-qa',
            by: 'parallel-implement',
            runId: specRecord.pipelineRunId,
          });
        } else {
          await source.transitionState(
            item.externalId,
            'factory:in-progress',
            'factory:needs-human',
          );
          emitStateTransitionEvent({
            projectId: slug,
            workItemId: item.id,
            from: 'factory:in-progress',
            to: 'factory:needs-human',
            by: 'parallel-implement',
            runId: specRecord.pipelineRunId,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        await source.comment(
          item.externalId,
          `parallel-implement: workflow failed after dispatch. Escalating to needs-human.\n\nError: ${error.message}`,
        );
        await source.transitionState(item.externalId, 'factory:in-progress', 'factory:needs-human');
        emitStateTransitionEvent({
          projectId: slug,
          workItemId: item.id,
          from: 'factory:in-progress',
          to: 'factory:needs-human',
          by: 'parallel-implement',
          runId: specRecord.pipelineRunId,
        });
      }
    },
  );
}

/** Run the merge conflict resolution workflow for a single issue. Drops duplicate triggers. */
export async function dispatchResolveConflict(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(
    slug,
    issueNumber,
    'dispatchResolveConflict',
    dispatchResolveConflict,
    async () => {
      // Cross-package boundary: slices/ is not a workspace package (rule 28a).
      const { runResolveConflictWorkflow } = (await import(sliceUrl('resolve-conflict'))) as {
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

      logger.info('dispatchResolveConflict: completed; retrospection will run on a future tick', {
        slug,
        issueNumber,
      });
    },
  );
}
