import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { ResearchOutput } from '@goose-hub/skills/research/schema.js';
import { withParallelLock } from './dispatch-lock.js';
import { createMockWorktree } from './mock-worktree.js';
import { REPO_ROOT, sliceUrl } from './slice-url.js';
import { getSourceForSlug } from './source.js';

type ResearchCompletePayload = {
  research?: ResearchOutput;
};

function latestResearchPayload(
  events: Array<{ kind: string; payload: unknown }>,
): ResearchCompletePayload | null {
  const latest = [...events].reverse().find((event) => event.kind === 'agent.research-complete');
  return (latest?.payload as ResearchCompletePayload | undefined) ?? null;
}

function targetStateForResearch(research: ResearchOutput | undefined): StateName {
  if (research == null) return 'factory:needs-human';
  const actionableFollowUps = research.followUpWork.filter((candidate) => candidate.actionable);
  if (research.actionability === 'directly-actionable' && actionableFollowUps.length === 1) {
    return 'factory:dev-ready';
  }
  return 'factory:needs-human';
}

function hasEquivalentResearchCompleteTransition(
  events: Array<{ kind: string; payload: unknown }>,
  targetState: StateName,
): boolean {
  let latestResearchIndex = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.kind === 'agent.research-complete') {
      latestResearchIndex = i;
      break;
    }
  }
  if (latestResearchIndex === -1) return false;

  return events.slice(latestResearchIndex + 1).some((event) => {
    if (event.kind !== 'state.transitioned') return false;
    const payload = event.payload as { from?: unknown; to?: unknown; by?: unknown } | null;
    return (
      payload?.from === 'factory:research-complete' &&
      payload.to === targetState &&
      payload.by === 'research-complete'
    );
  });
}

export async function dispatchResearch(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(slug, issueNumber, 'dispatchResearch', dispatchResearch, async () => {
    const { runResearchWorkflow } = (await import(sliceUrl('research'))) as {
      runResearchWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        repoRoot: string,
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchResearch: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    const mockDeps: Record<string, unknown> | undefined =
      process.env.MOCK_AGENTS === 'true'
        ? {
            createWorktreeImpl: (_repo: string, runId: string) =>
              createMockWorktree('research', runId),
          }
        : undefined;
    await runResearchWorkflow(item, source, slug, REPO_ROOT, mockDeps);
  });
}

export async function dispatchResearchComplete(
  slug: string,
  issueNumber: number,
): Promise<void> {
  await withParallelLock(
    slug,
    issueNumber,
    'dispatchResearchComplete',
    dispatchResearchComplete,
    async () => {
      const source = await getSourceForSlug(slug);
      if (source == null) {
        logger.error('dispatchResearchComplete: no source for slug', { slug });
        return;
      }

      const item = await source.getItem(issueNumber.toString());
      if (item.state !== 'factory:research-complete') {
        logger.info('dispatchResearchComplete: state already moved', {
          slug,
          issueNumber,
          state: item.state,
        });
        return;
      }

      const events = eventStore.replay({ projectId: slug, workItemId: item.id });
      const research = latestResearchPayload(events)?.research;
      const targetState = targetStateForResearch(research);
      if (hasEquivalentResearchCompleteTransition(events, targetState)) {
        logger.info('dispatchResearchComplete: equivalent transition already emitted', {
          slug,
          issueNumber,
          targetState,
        });
        return;
      }

      await source.transitionState(item.id, 'factory:research-complete', targetState);
      emitStateTransitionEvent({
        projectId: slug,
        workItemId: item.id,
        from: 'factory:research-complete',
        to: targetState,
        by: 'research-complete',
        extraPayload: {
          actionability: research?.actionability ?? 'missing-artifact',
          actionableFollowUpCount:
            research?.followUpWork.filter((candidate) => candidate.actionable).length ?? 0,
        },
      });

      if (targetState === 'factory:needs-human') {
        await source.comment(
          item.externalId,
          'Research complete. Human choice is needed before Factory can route follow-up work.',
        );
      }
    },
  );
}
