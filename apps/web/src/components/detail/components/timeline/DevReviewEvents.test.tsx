import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DevReviewBudgetSkippedEvent,
  DevReviewCompletedEvent,
  DevReviewErrorEvent,
  DevReviewFailedEvent,
  DevReviewResponseCompletedEvent,
  DevReviewResponseFailedEvent,
  DevReviewResponseStartedEvent,
  DevReviewStartedEvent,
} from './DevReviewEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown = {}): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    createdAt: '2026-05-13T10:00:00Z',
    workItemId: 'github:shaunnez/goose-hub#800',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('DevReviewEvents', () => {
  it('renders dev-review.started with title', () => {
    render(
      <ul>
        <DevReviewStartedEvent
          event={makeEvent('dev-review.started', { pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review started')).toBeTruthy();
  });

  it('renders dev-review.completed with verdict', () => {
    render(
      <ul>
        <DevReviewCompletedEvent
          event={makeEvent('dev-review.completed', { verdict: 'proceed', pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review completed')).toBeTruthy();
    expect(screen.getByText('proceed')).toBeTruthy();
  });

  it('renders dev-review.failed with error reason', () => {
    render(
      <ul>
        <DevReviewFailedEvent
          event={makeEvent('dev-review.failed', {
            errorReason: 'agent timed out',
            pipelineRunId: 'abc123',
          })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review failed')).toBeTruthy();
    expect(screen.getByText('agent timed out')).toBeTruthy();
  });

  it('renders dev-review.budget-skipped', () => {
    render(
      <ul>
        <DevReviewBudgetSkippedEvent
          event={makeEvent('dev-review.budget-skipped', { pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review budget skipped')).toBeTruthy();
  });

  it('renders dev-review.response-started', () => {
    render(
      <ul>
        <DevReviewResponseStartedEvent
          event={makeEvent('dev-review.response-started', { pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Response started')).toBeTruthy();
  });

  it('renders dev-review.response-completed', () => {
    render(
      <ul>
        <DevReviewResponseCompletedEvent
          event={makeEvent('dev-review.response-completed', { pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Response completed')).toBeTruthy();
  });

  it('renders dev-review.response-failed', () => {
    render(
      <ul>
        <DevReviewResponseFailedEvent
          event={makeEvent('dev-review.response-failed', {
            errorReason: 'network error',
            pipelineRunId: 'abc123',
          })}
        />
      </ul>,
    );
    expect(screen.getByText('Response failed')).toBeTruthy();
    expect(screen.getByText('network error')).toBeTruthy();
  });

  it('renders dev-review.error', () => {
    render(
      <ul>
        <DevReviewErrorEvent
          event={makeEvent('dev-review.error', {
            errorReason: 'internal error',
            pipelineRunId: 'abc123',
          })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review error')).toBeTruthy();
    expect(screen.getByText('internal error')).toBeTruthy();
  });
});
