/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    runId: 'run-1',
    createdAt: '2026-05-14T04:46:39Z',
    workItemId: 'github:shaunnez/goose-hub#783',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('agent lifecycle timeline events', () => {
  it('renders runDisposition badges on agent run failures', () => {
    const event = makeEvent('agent.run-failed', {
      skill: 'parallel-implement',
      error: 'Dev review blocked PR open',
      runDisposition: 'blocked-gate',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText(/Agent run failed: parallel-implement/)).toBeTruthy();
    expect(screen.getByText('Blocked Gate')).toBeTruthy();
  });
});
