import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';

import { resolveDecisionSummaryStatus } from './state';

function makeEvent(
  id: number,
  kind: string,
  runId: string | null,
  overrides: Partial<AgentEventDto> = {},
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'item-1',
    kind,
    payload: overrides.payload ?? null,
    runId,
    createdAt: new Date(1000 * id).toISOString(),
    ...overrides,
  };
}

describe('resolveDecisionSummaryStatus', () => {
  it('returns completed after a later grill terminal event', () => {
    const event = makeEvent(2, 'agent.decision-summary-live', 'run-1');
    const events = [
      makeEvent(1, 'agent.run-started', 'run-1'),
      event,
      makeEvent(3, 'grill.completed', 'workflow-1'),
    ];

    expect(resolveDecisionSummaryStatus(event, events)).toBe('completed');
  });

  it('returns live when no later terminal event follows', () => {
    const event = makeEvent(2, 'agent.decision-summary-live', 'run-1');
    const events = [
      makeEvent(1, 'agent.run-started', 'run-1'),
      event,
      makeEvent(3, 'agent.log', 'run-1'),
    ];

    expect(resolveDecisionSummaryStatus(event, events)).toBe('live');
  });

  it('does not complete from an earlier terminal event', () => {
    const event = makeEvent(3, 'agent.decision-summary-live', 'run-1');
    const events = [
      makeEvent(1, 'grill.question-posted', 'workflow-1'),
      makeEvent(2, 'agent.run-started', 'run-1'),
      event,
    ];

    expect(resolveDecisionSummaryStatus(event, events)).toBe('live');
  });

  it('returns completed after a gate-pending to grilling transition', () => {
    const event = makeEvent(2, 'agent.decision-summary-live', 'run-1');
    const events = [
      makeEvent(1, 'agent.run-started', 'run-1'),
      event,
      makeEvent(3, 'state.transitioned', null, {
        payload: { fromState: 'factory:gate-pending', toState: 'factory:grilling' },
      }),
    ];

    expect(resolveDecisionSummaryStatus(event, events)).toBe('completed');
  });
});
