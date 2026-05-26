import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';
import {
  ParallelIterationStartedEvent,
  ParallelWpCommittedEvent,
  ParallelWpStartedEvent,
  SpecCompletedEvent,
  SpecPrdContextAttachedEvent,
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

  it('renders spec.prd-context-attached as PRD context metadata instead of raw JSON', () => {
    render(
      <ul>
        <SpecPrdContextAttachedEvent
          event={makeEvent('spec.prd-context-attached', {
            source: 'event',
            prdRunId: '8c59166f-0844-41c5-ab2b-1f21261428d2',
            artifactKey: 'prd-planning-context.raw-prd:d7c34899ada5664e5ab3366c',
            inlineSections: ['title', 'problem', 'acceptanceCriteria', 'implementationDecisions'],
          })}
        />
      </ul>,
    );

    expect(screen.getByText('PRD context attached')).toBeTruthy();
    expect(screen.getByText('event')).toBeTruthy();
    expect(screen.getByText('prd 8c59166f')).toBeTruthy();
    expect(screen.getByText('4 inline sections')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('prd-planning-context.raw-prd:d7c34899ada5664e5ab3366c');
    expect(rendered).toContain('title, problem, acceptanceCriteria, implementationDecisions');
    expect(rendered).not.toContain('"inlineSections"');
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

  it('renders wp-persisted with durability metadata instead of raw JSON', () => {
    const event = makeEvent('parallel-implement.wp-persisted', {
      wpId: 'WP2',
      pushedSha: 'f88f39a1080dc0ddc84c6e3bc9996ce1d9893368',
      integrationBranch: 'factory/run/805e37ae-2c79-40ef-b017-07b82dafbd09',
      filesPersisted: ['apps/web/src/Button.tsx', 'apps/web/src/Button.test.tsx'],
      persistMode: 'direct-integration-commit',
      pipelineRunId: '805e37ae-2c79-40ef-b017-07b82dafbd09',
      rawProbeKey: 'raw-value',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('WP2 persisted')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('f88f39a1');
    expect(rendered).toContain('factory/run/805e37ae-2c79-40ef-b017-07b82dafbd09');
    expect(rendered).toContain('2 files persisted');
    expect(rendered).toContain('direct-integration-commit');
    expect(rendered).not.toContain('"pushedSha"');
    expect(rendered).not.toContain('rawProbeKey');
    expect(rendered).not.toContain('raw-value');
  });

  it('renders terminal-blocked WPs as failure cards', () => {
    const event = makeEvent('parallel-implement.wp-terminal-blocked', {
      wpId: 'WP1',
      wpRunId: 'pipeline-terminal-tool-failure:wp:WP1:iter:1',
      decisionKind: 'TOOL_FAILURE',
      errorReason: 'implement-wp emitted TOOL_FAILURE: test harness unavailable',
      pipelineRunId: '805e37ae-2c79-40ef-b017-07b82dafbd09',
      rawProbeKey: 'raw-value',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    const rendered = document.body.textContent ?? '';
    expect(screen.getByText('WP1 terminal blocker')).toBeTruthy();
    expect(rendered).toContain('test harness unavailable');
    expect(rendered).toContain('Decision: TOOL_FAILURE');
    expect(rendered).toContain('pipeline 805e37ae');
    expect(rendered).not.toContain('rawProbeKey');
    expect(rendered).not.toContain('raw-value');
  });
});
