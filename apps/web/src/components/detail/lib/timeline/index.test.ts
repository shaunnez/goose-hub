import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import type { RenderItem } from './index';
import { groupByDiscoverPhase, groupByReviewWorkflow } from './index';

function makeEvent(
  id: number,
  kind: string,
  payload: Record<string, unknown>,
  overrides: Partial<AgentEventDto> = {},
): AgentEventDto {
  return {
    id,
    kind,
    payload,
    createdAt: new Date(1000 * id).toISOString(),
    workItemId: 'item-1',
    projectId: 'proj',
    ...overrides,
  } as AgentEventDto;
}

function makeReviewItems(...events: AgentEventDto[]): RenderItem[] {
  return events.map((event) => ({ kind: 'event', event }));
}

function makeRunGroup(
  runId: string,
  events: AgentEventDto[],
  { skill, endedAt = null }: { skill: string | null; endedAt?: string | null },
): RenderItem {
  return {
    kind: 'run-group',
    runId,
    items: events.map((event) => ({ kind: 'event', event })),
    skill,
    startedAt: events[0]?.createdAt ?? null,
    endedAt,
    lastEventAt: events.at(-1)?.createdAt ?? null,
    personaId: null,
    modelId: null,
    runtime: null,
  };
}

describe('groupByDiscoverPhase grill completion status', () => {
  it('marks a grill phase completed once the same discover session advances into PRD work', () => {
    const discoverSessionId = 'discover-session-completed';
    const workflowRunId = 'discover-workflow-completed';

    const result = groupByDiscoverPhase([
      makeRunGroup(
        `${workflowRunId}:grill-me`,
        [
          makeEvent(1, 'agent.run-started', {
            discoverSessionId,
            workflowRunId,
            skill: 'grill-me',
          }),
        ],
        { skill: 'grill-me' },
      ),
      makeRunGroup(
        `${workflowRunId}:write-prd`,
        [
          makeEvent(2, 'agent.run-started', {
            discoverSessionId,
            workflowRunId,
            skill: 'write-prd',
          }),
          makeEvent(3, 'prd.drafted', { discoverSessionId, workflowRunId }),
        ],
        { skill: 'write-prd', endedAt: new Date(3000).toISOString() },
      ),
    ]);

    const grillPhase = result.find(
      (item): item is Extract<RenderItem, { kind: 'phase-group' }> =>
        item.kind === 'phase-group' && item.phase === 'grill',
    );

    expect(grillPhase?.status).toBe('completed');
  });

  it('keeps a grill phase live until that discover session gets completion evidence', () => {
    const discoverSessionId = 'discover-session-live';
    const workflowRunId = 'discover-workflow-live';

    const result = groupByDiscoverPhase([
      makeRunGroup(
        `${workflowRunId}:grill-me`,
        [
          makeEvent(1, 'agent.run-started', {
            discoverSessionId,
            workflowRunId,
            skill: 'grill-me',
          }),
        ],
        { skill: 'grill-me' },
      ),
    ]);

    const grillPhase = result.find(
      (item): item is Extract<RenderItem, { kind: 'phase-group' }> =>
        item.kind === 'phase-group' && item.phase === 'grill',
    );

    expect(grillPhase?.status).toBe('live');
  });
});

describe('groupByReviewWorkflow grill completion status', () => {
  function makeAnsweredGrillEvents(
    reviewWorkflowRunId: string,
    transitionPayload: Record<string, unknown> = {},
  ): AgentEventDto[] {
    return [
      makeEvent(1, 'question.asked', { reviewWorkflowRunId }),
      makeEvent(2, 'state.transitioned', {
        reviewWorkflowRunId,
        to: 'factory:grilling',
        ...transitionPayload,
      }),
    ];
  }

  it('keeps unrelated review workflows live when they only transition into a post-grill state', () => {
    const reviewWorkflowRunId = 'review-non-grill-transition';

    const result = groupByReviewWorkflow(
      makeReviewItems(
        makeEvent(1, 'review.started', { reviewWorkflowRunId }),
        makeEvent(2, 'state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:prd-drafting',
        }),
      ),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('review-group');
    if (result[0]?.kind !== 'review-group') return;

    expect(result[0].status).toBe('live');
  });

  it('marks a grill review group as completed after transitioning to a post-grill state', () => {
    const reviewWorkflowRunId = 'review-grill-complete';

    const result = groupByReviewWorkflow(
      makeReviewItems(
        ...makeAnsweredGrillEvents(reviewWorkflowRunId),
        makeEvent(3, 'state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:prd-drafting',
        }),
      ),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('review-group');
    if (result[0]?.kind !== 'review-group') return;

    expect(result[0].status).toBe('completed');
    expect(result[0].endedAt).toBe(result[0].lastEventAt);
  });

  it('marks a grill review group completed when grilling resumes from a different state', () => {
    const reviewWorkflowRunId = 'review-grill-resumed';

    const result = groupByReviewWorkflow(
      makeReviewItems(
        ...makeAnsweredGrillEvents(reviewWorkflowRunId, { from: 'factory:reviewing' }),
        makeEvent(3, 'state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:any-post-grill-state',
        }),
      ),
    );

    expect(result[0]?.kind).toBe('review-group');
    if (result[0]?.kind !== 'review-group') return;

    expect(result[0].status).toBe('completed');
  });

  it('marks a grill review group completed when the resume transition omits from', () => {
    const reviewWorkflowRunId = 'review-grill-no-from';

    const result = groupByReviewWorkflow(
      makeReviewItems(
        ...makeAnsweredGrillEvents(reviewWorkflowRunId),
        makeEvent(3, 'state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:post-grill-follow-up',
        }),
      ),
    );

    expect(result[0]?.kind).toBe('review-group');
    if (result[0]?.kind !== 'review-group') return;

    expect(result[0].status).toBe('completed');
  });

  it('keeps grill review groups live until a reply resumes grilling', () => {
    const reviewWorkflowRunId = 'review-grill-unanswered';

    const result = groupByReviewWorkflow(
      makeReviewItems(
        makeEvent(1, 'question.asked', { reviewWorkflowRunId }),
        makeEvent(2, 'state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:prd-drafting',
        }),
      ),
    );

    expect(result[0]?.kind).toBe('review-group');
    if (result[0]?.kind !== 'review-group') return;

    expect(result[0].status).toBe('live');
  });

  it.each([
    ['review.wave-failed', 'failed'],
    ['agent.run-failed', 'failed'],
  ] as const)('keeps %s higher priority than grill completion', (kind, expectedStatus) => {
    const reviewWorkflowRunId = `review-${kind}`;

    const result = groupByReviewWorkflow(
      makeReviewItems(
        makeEvent(1, kind, { reviewWorkflowRunId }),
        ...makeAnsweredGrillEvents(reviewWorkflowRunId),
        makeEvent(3, 'state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:prd-drafting',
        }),
      ),
    );

    expect(result[0]?.kind).toBe('review-group');
    if (result[0]?.kind !== 'review-group') return;

    expect(result[0].status).toBe(expectedStatus);
  });

  it.each([
    ['review.escalated', { reviewWorkflowRunId: 'review-escalated' }, 'needs-human'],
    [
      'state.transitioned',
      { reviewWorkflowRunId: 'review-needs-human', to: 'factory:needs-human' },
      'needs-human',
    ],
  ] as const)('keeps %s higher priority than grill completion', (kind, payload, expectedStatus) => {
    const reviewWorkflowRunId = payload.reviewWorkflowRunId as string;

    const result = groupByReviewWorkflow(
      makeReviewItems(
        makeEvent(1, kind, payload),
        ...makeAnsweredGrillEvents(reviewWorkflowRunId),
        makeEvent(3, 'state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:prd-drafting',
        }),
      ),
    );

    expect(result[0]?.kind).toBe('review-group');
    if (result[0]?.kind !== 'review-group') return;

    expect(result[0].status).toBe(expectedStatus);
  });
});
