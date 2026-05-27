import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import type { RenderItem } from './index';
import { groupByReviewWorkflow } from './index';

function makeEvent(id: number, kind: string, payload: Record<string, unknown>): AgentEventDto {
  return {
    id,
    kind,
    payload,
    createdAt: new Date(1000 * id).toISOString(),
    workItemId: 'item-1',
    projectId: 'proj',
  } as AgentEventDto;
}

function makeReviewItems(...events: AgentEventDto[]): RenderItem[] {
  return events.map((event) => ({ kind: 'event', event }));
}

describe('groupByReviewWorkflow grill completion status', () => {
  function makeAnsweredGrillEvents(reviewWorkflowRunId: string): AgentEventDto[] {
    return [
      makeEvent(1, 'question.asked', { reviewWorkflowRunId }),
      makeEvent(2, 'state.transitioned', {
        reviewWorkflowRunId,
        from: 'factory:gate-pending',
        to: 'factory:grilling',
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
