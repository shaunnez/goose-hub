import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../event-stream/store.js';
import { projectActionableEvent } from './projector.js';
import { resolve } from './reducer.js';
import { listInterventions } from './repository.js';

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 1,
    projectId: 'proj',
    workItemId: 'github:owner/repo#1',
    kind: 'state.transitioned',
    payload: { from: 'factory:in-progress', to: 'factory:needs-human', by: 'qa' },
    runId: null,
    personaId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('intervention projector', () => {
  it('dedupes repeated actionable events and only schedules first proposal', () => {
    const first = projectActionableEvent(event({ id: 101, workItemId: 'github:owner/repo#101' }));
    const duplicate = projectActionableEvent(
      event({ id: 102, workItemId: 'github:owner/repo#101' }),
    );

    expect(first.opened?.ok).toBe(true);
    expect(first.shouldScheduleProposer).toBe(true);
    expect(duplicate.opened?.ok).toBe(true);
    expect(duplicate.shouldScheduleProposer).toBe(false);
    expect(
      listInterventions({ projectId: 'proj', workItemId: 'github:owner/repo#101' }),
    ).toHaveLength(1);
  });

  it('reopens a resolved recurrence and schedules proposer work', () => {
    const first = projectActionableEvent(event({ id: 201, workItemId: 'github:owner/repo#201' }));
    expect(first.opened?.ok).toBe(true);
    if (first.opened == null || !first.opened.ok) return;

    const resolved = resolve({
      id: first.opened.intervention.id,
      expectedVersion: first.opened.intervention.version,
      reason: 'cleared',
    });
    expect(resolved.ok).toBe(true);

    const recurrence = projectActionableEvent(
      event({ id: 202, workItemId: 'github:owner/repo#201' }),
    );
    expect(recurrence.opened?.ok).toBe(true);
    expect(recurrence.shouldScheduleProposer).toBe(true);
    if (recurrence.opened?.ok) {
      expect(recurrence.opened.intervention.id).toBe(first.opened.intervention.id);
      expect(recurrence.opened.intervention.status).toBe('OPEN');
    }
  });

  it('ignores applier-caused state transitions', () => {
    const result = projectActionableEvent(
      event({
        id: 301,
        workItemId: 'github:owner/repo#301',
        payload: {
          from: 'factory:approved',
          to: 'factory:needs-human',
          causedByInterventionId: 'intervention-1',
        },
      }),
    );
    expect(result.opened).toBeNull();
    expect(result.shouldScheduleProposer).toBe(false);
  });
});
