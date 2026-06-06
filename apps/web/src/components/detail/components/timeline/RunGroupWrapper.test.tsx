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

describe('RunGroupWrapper', () => {
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

    expect(screen.getByText('Preflight superseded')).toBeTruthy();
    expect(screen.queryByText('Complete')).toBeNull();
  });
});
