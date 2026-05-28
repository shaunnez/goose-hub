import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type RenderItem, groupByReviewWorkflow } from '../../lib/timeline';
import { ReviewGroupWrapper } from './ReviewGroupWrapper';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown = {}): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    createdAt: '2026-05-21T01:54:44Z',
    workItemId: 'github:shaunnez/goose-hub#800',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('ReviewGroupWrapper', () => {
  it('labels the parent as Review Run and shows terminal completion status', () => {
    const item: RenderItem = {
      kind: 'event',
      event: makeEvent('review.completed', {
        reviewWorkflowRunId: 'review-workflow-123',
        verdict: 'approved',
      }),
    };

    render(
      <ul>
        <ReviewGroupWrapper
          reviewWorkflowRunId="review-workflow-123"
          items={[item]}
          status="completed"
          startedAt="2026-05-21T01:54:44Z"
          endedAt="2026-05-21T01:55:44Z"
          lastEventAt="2026-05-21T01:55:44Z"
          renderItem={(child, idx) => <li key={`${child.kind}-${idx}`}>review child</li>}
        />
      </ul>,
    );

    expect(screen.getByText('Review Run')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.queryByText('(Unknown) Run')).toBeNull();
  });

  it('renders a post-grill review workflow with the completed presentation', () => {
    const reviewWorkflowRunId = 'review-grill-complete';
    const grouped = groupByReviewWorkflow([
      {
        kind: 'event',
        event: makeEvent('question.asked', { reviewWorkflowRunId }),
      },
      {
        kind: 'event',
        event: makeEvent('state.transitioned', {
          reviewWorkflowRunId,
          from: 'factory:gate-pending',
          to: 'factory:grilling',
        }),
      },
      {
        kind: 'event',
        event: makeEvent('state.transitioned', {
          reviewWorkflowRunId,
          to: 'factory:prd-drafting',
        }),
      },
    ]);
    const reviewGroup = grouped[0];

    expect(reviewGroup?.kind).toBe('review-group');
    if (reviewGroup?.kind !== 'review-group') return;

    render(
      <ul>
        <ReviewGroupWrapper
          reviewWorkflowRunId={reviewGroup.reviewWorkflowRunId}
          items={reviewGroup.items}
          status={reviewGroup.status}
          startedAt={reviewGroup.startedAt}
          endedAt={reviewGroup.endedAt}
          lastEventAt={reviewGroup.lastEventAt}
          renderItem={(child, idx) => <li key={`${child.kind}-${idx}`}>review child</li>}
        />
      </ul>,
    );

    expect(screen.getByText('Review Run')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
  });
});
