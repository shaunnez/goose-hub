import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderItem } from '../../lib/timeline';
import { RunGroupWrapper } from './RunGroupWrapper';

vi.mock('@/lib/usePersonaMap', () => ({
  getPersonaLabel: () => null,
  usePersonaMap: () => ({}),
}));

afterEach(cleanup);

function makeEvent(id: number, kind: string, payload: unknown, runId = 'qa-run'): AgentEventDto {
  return {
    id,
    kind,
    payload,
    runId,
    createdAt: new Date(1000 * id).toISOString(),
    workItemId: 'github:shaunnez/goose-hub#1210',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

function makeRecentEvent(
  id: number,
  kind: string,
  payload: unknown,
  runId = 'qa-run',
): AgentEventDto {
  return {
    ...makeEvent(id, kind, payload, runId),
    createdAt: new Date(Date.now() - (10 - id) * 1000).toISOString(),
  };
}

describe('RunGroupWrapper', () => {
  it('shows QA preflight running banner for live preflight-only QA groups', () => {
    const events = [
      makeRecentEvent(1, 'qa.preflight-started', {
        runId: 'qa-run',
        qaAttemptId: 'qa-attempt',
        status: 'running',
      }),
      makeRecentEvent(2, 'qa.preflight-step-started', {
        runId: 'qa-run',
        qaAttemptId: 'qa-attempt',
        step: 'test',
        command: 'pnpm test',
      }),
    ];
    const items: RenderItem[] = events.map((event) => ({ kind: 'event', event }));

    render(
      <ul>
        <RunGroupWrapper
          runId="qa-attempt"
          items={items}
          idx={0}
          skill="qa"
          startedAt={events[0].createdAt}
          endedAt={null}
          lastEventAt={events[1].createdAt}
          personaId={null}
          modelId={null}
          runtime={null}
          renderItem={(_item, idx) => <li key={idx}>child</li>}
        />
      </ul>,
    );

    expect(screen.getByText('QA preflight running...')).toBeTruthy();
    expect(screen.queryByText('Agent running...')).toBeNull();
  });

  it('shows Agent running banner after a live QA agent has started', () => {
    const events = [
      makeRecentEvent(1, 'qa.preflight-started', {
        runId: 'qa-run',
        qaAttemptId: 'qa-attempt',
        status: 'running',
      }),
      makeRecentEvent(2, 'agent.run-started', {
        skill: 'qa',
        qaAttemptId: 'qa-attempt',
      }),
    ];
    const items: RenderItem[] = events.map((event) => ({ kind: 'event', event }));

    render(
      <ul>
        <RunGroupWrapper
          runId="qa-attempt"
          items={items}
          idx={0}
          skill="qa"
          startedAt={events[0].createdAt}
          endedAt={null}
          lastEventAt={events[1].createdAt}
          personaId={null}
          modelId={null}
          runtime={null}
          renderItem={(_item, idx) => <li key={idx}>child</li>}
        />
      </ul>,
    );

    expect(screen.getByText('Agent running...')).toBeTruthy();
    expect(screen.queryByText('QA preflight running...')).toBeNull();
  });

  it('shows superseded QA preflight status even after the QA agent started', () => {
    const events = [
      makeEvent(1, 'qa.preflight-started', {
        runId: 'qa-run',
        qaAttemptId: 'qa-attempt',
        status: 'running',
      }),
      makeEvent(2, 'agent.run-started', {
        skill: 'qa',
        qaAttemptId: 'qa-attempt',
      }),
      makeEvent(3, 'qa.workflow-aborted', {
        runId: 'qa-run',
        qaAttemptId: 'qa-attempt',
        reason: 'superseded',
      }),
    ];
    const items: RenderItem[] = events.map((event) => ({ kind: 'event', event }));

    render(
      <ul>
        <RunGroupWrapper
          runId="qa-attempt"
          items={items}
          idx={0}
          skill="qa"
          startedAt={events[0].createdAt}
          endedAt={events[2].createdAt}
          lastEventAt={events[2].createdAt}
          personaId={null}
          modelId={null}
          runtime={null}
          renderItem={(_item, idx) => <li key={idx}>child</li>}
        />
      </ul>,
    );

    expect(screen.getAllByText('Preflight superseded').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Complete')).toBeNull();
  });

  it('does not synthesize tool calls for QA preflight rows and keeps real tool calls', () => {
    const events = [
      makeRecentEvent(1, 'qa.preflight-step-started', {
        runId: 'qa-run',
        qaAttemptId: 'qa-attempt',
        step: 'lint',
        command: 'pnpm lint',
      }),
      makeRecentEvent(2, 'agent.run-started', {
        skill: 'qa',
        qaAttemptId: 'qa-attempt',
      }),
      makeRecentEvent(3, 'agent.tool-call', {
        skill: 'qa',
        qaAttemptId: 'qa-attempt',
        tool_name: 'Bash',
      }),
    ];
    const items: RenderItem[] = events.map((event) => ({ kind: 'event', event }));
    const renderedKinds: string[] = [];

    render(
      <ul>
        <RunGroupWrapper
          runId="qa-attempt"
          items={items}
          idx={0}
          skill="qa"
          startedAt={events[0].createdAt}
          endedAt={null}
          lastEventAt={events[2].createdAt}
          personaId={null}
          modelId={null}
          runtime={null}
          renderItem={(item, idx) => {
            if (item.kind === 'event') renderedKinds.push(item.event.kind);
            return <li key={idx}>{item.kind === 'event' ? item.event.kind : item.kind}</li>;
          }}
        />
      </ul>,
    );

    expect(renderedKinds).toContain('agent.tool-call');
    expect(renderedKinds).not.toContain('qa.preflight-step-started');
    expect(renderedKinds.filter((kind) => kind === 'agent.tool-call')).toHaveLength(1);
  });
});
