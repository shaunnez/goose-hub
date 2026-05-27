import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RenderItem } from '../../lib/timeline';
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

  it('shows completed status for terminal grill runs without a Live badge', () => {
    const item: RenderItem = {
      kind: 'event',
      event: makeEvent('grill.question-posted', {
        grillWorkflowRunId: 'grill-workflow-123',
        question: 'Why this approach?',
      }),
    };

    render(
      <ul>
        <ReviewGroupWrapper
          reviewWorkflowRunId="grill-workflow-123"
          items={[item]}
          status="completed"
          startedAt="2026-05-21T01:54:44Z"
          endedAt="2026-05-21T01:55:44Z"
          lastEventAt="2026-05-21T01:55:44Z"
          renderItem={(child, idx) => <li key={`${child.kind}-${idx}`}>grill child</li>}
        />
      </ul>,
    );

    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
  });
});
