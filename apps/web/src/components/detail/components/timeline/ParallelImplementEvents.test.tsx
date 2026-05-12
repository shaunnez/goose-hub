import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ParallelIterationStartedEvent,
  ParallelWpCommittedEvent,
  ParallelWpStartedEvent,
  SpecCompletedEvent,
} from './ParallelImplementEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    createdAt: '2026-05-12T07:33:41Z',
    workItemId: 'github:shaunnez/goose-hub#743',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('ParallelImplementEvents', () => {
  it('renders spec.completed as summary text instead of raw JSON', () => {
    render(
      <ul>
        <SpecCompletedEvent
          event={makeEvent('spec.completed', {
            pipelineRunId: '805e37ae-2c79-40ef-b017-07b82dafbd09',
            workItemId: 'github:shaunnez/goose-hub#743',
          })}
        />
      </ul>,
    );

    expect(screen.getByText('Spec authored')).toBeTruthy();
    expect(screen.getByText('Work item #743')).toBeTruthy();
    expect(screen.getByText('pipeline 805e37ae')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"pipelineRunId"');
  });

  it('renders iteration-started with work package chips', () => {
    render(
      <ul>
        <ParallelIterationStartedEvent
          event={makeEvent('parallel-implement.iteration-started', {
            iteration: 1,
            wpCount: 3,
            wpIds: ['WP1', 'WP2', 'WP3'],
            pipelineRunId: '805e37ae-2c79-40ef-b017-07b82dafbd09',
          })}
        />
      </ul>,
    );

    expect(screen.getByText('Iteration 1 started')).toBeTruthy();
    expect(screen.getByText('3 work packages')).toBeTruthy();
    expect(screen.getByText('WP1, WP2, WP3')).toBeTruthy();
  });

  it('renders wp-started without dumping scratchPath JSON', () => {
    render(
      <ul>
        <ParallelWpStartedEvent
          event={makeEvent('parallel-implement.wp-started', {
            wpId: 'WP3',
            iteration: 1,
            wpRunId: '13ab9ca2-54fe-4ea9-a6fb-e0dc227cd8f7:wp:WP3:iter:1',
            scratchPath:
              '/Users/shaunnesbitt/.factory/workspaces/13ab9ca2-54fe-4ea9-a6fb-e0dc227cd8f7:wp:WP3',
            pipelineRunId: '805e37ae-2c79-40ef-b017-07b82dafbd09',
          })}
        />
      </ul>,
    );

    expect(screen.getByText('WP3 started')).toBeTruthy();
    expect(screen.getByText('Iteration 1')).toBeTruthy();
    expect(screen.getByText('13ab9ca2-54fe-4ea9-a6fb-e0dc227cd8f7:wp:WP3')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"scratchPath"');
  });

  it('renders wp-committed with a short commit sha', () => {
    render(
      <ul>
        <ParallelWpCommittedEvent
          event={makeEvent('parallel-implement.wp-committed', {
            wpId: 'WP1',
            wpRunId: '13ab9ca2-54fe-4ea9-a6fb-e0dc227cd8f7:wp:WP1:iter:1',
            commitSha: '00bff479f0478c6de4d8685c9f2d44b3ea93c530',
            pipelineRunId: '805e37ae-2c79-40ef-b017-07b82dafbd09',
          })}
        />
      </ul>,
    );

    expect(screen.getByText('WP1 committed')).toBeTruthy();
    expect(screen.getByText('00bff479')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"commitSha"');
  });
});
