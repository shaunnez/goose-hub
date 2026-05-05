/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderItem } from '../lib/timeline';
import { renderTimelineItem } from './TimelineEvents';

vi.mock('@/lib/usePersonaMap', () => ({
  usePersonaMap: () => ({}),
  getPersonaLabel: () => null,
}));
vi.mock('@/lib/api', () => ({
  resumeIssue: vi.fn(),
}));

afterEach(cleanup);

function makeRunGroupItem(runId = 'run-test'): RenderItem {
  const now = new Date().toISOString();
  return {
    kind: 'run-group',
    runId,
    skill: 'implement',
    startedAt: now,
    endedAt: now,
    lastEventAt: now,
    personaId: null,
    items: [
      {
        kind: 'event',
        event: {
          id: 1,
          projectId: 'proj',
          workItemId: 'wi-1',
          kind: 'agent.run-started',
          payload: { skill: 'implement' },
          runId,
          createdAt: now,
        },
      },
      {
        kind: 'event',
        event: {
          id: 2,
          projectId: 'proj',
          workItemId: 'wi-1',
          kind: 'agent.run-completed',
          payload: {},
          runId,
          createdAt: now,
        },
      },
    ],
  };
}

const baseCtx = { slug: 'p', issueId: '1', latestRunId: null };

describe('Timeline expand/collapse all (#509)', () => {
  it('RunGroupWrapper starts open by default', () => {
    const item = makeRunGroupItem();
    const { container } = render(<ol>{renderTimelineItem(item, 0, baseCtx)}</ol>);
    const details = container.querySelector('details');
    expect(details?.open).toBe(true);
  });

  it('RunGroupWrapper closes when expandSignal has open: false', () => {
    const item = makeRunGroupItem();
    const { container, rerender } = render(<ol>{renderTimelineItem(item, 0, baseCtx)}</ol>);

    rerender(
      <ol>
        {renderTimelineItem(item, 0, {
          ...baseCtx,
          expandSignal: { open: false, seq: 1 },
        })}
      </ol>,
    );

    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
  });

  it('RunGroupWrapper opens when expandSignal has open: true after being closed', () => {
    const item = makeRunGroupItem();
    const { container, rerender } = render(
      <ol>
        {renderTimelineItem(item, 0, {
          ...baseCtx,
          expandSignal: { open: false, seq: 1 },
        })}
      </ol>,
    );

    rerender(
      <ol>
        {renderTimelineItem(item, 0, {
          ...baseCtx,
          expandSignal: { open: true, seq: 2 },
        })}
      </ol>,
    );

    const details = container.querySelector('details');
    expect(details?.open).toBe(true);
  });

  it('seq increment with same open direction applies the signal again', () => {
    const item = makeRunGroupItem();
    // Start collapsed via signal seq:1
    const { container, rerender } = render(
      <ol>
        {renderTimelineItem(item, 0, {
          ...baseCtx,
          expandSignal: { open: false, seq: 1 },
        })}
      </ol>,
    );
    expect(container.querySelector('details')?.open).toBe(false);

    // expand via seq:2
    rerender(
      <ol>
        {renderTimelineItem(item, 0, {
          ...baseCtx,
          expandSignal: { open: true, seq: 2 },
        })}
      </ol>,
    );
    expect(container.querySelector('details')?.open).toBe(true);

    // collapse again via seq:3
    rerender(
      <ol>
        {renderTimelineItem(item, 0, {
          ...baseCtx,
          expandSignal: { open: false, seq: 3 },
        })}
      </ol>,
    );
    expect(container.querySelector('details')?.open).toBe(false);
  });
});
