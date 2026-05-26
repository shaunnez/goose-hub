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

describe('gate timeline events', () => {
  it('renders awaiting-human gate reason for blocked dev-review', () => {
    const event = makeEvent('gate.awaiting-human', {
      gate: 'dev-review',
      reason: 'P1 dev-review finding(s) were dismissed; human review required before PR open.',
      runDisposition: 'blocked-gate',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Gate — awaiting human')).toBeTruthy();
    expect(screen.getByText('dev-review')).toBeTruthy();
    expect(screen.getByText(/P1 dev-review/)).toBeTruthy();
  });
});
