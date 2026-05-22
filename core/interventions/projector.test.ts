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
  it.each([
    [
      'gate.awaiting-human',
      event({
        id: 11,
        kind: 'gate.awaiting-human',
        payload: { reason: 'retry cap hit' },
        workItemId: 'github:owner/repo#gate-human',
      }),
      'needs_human',
    ],
    [
      'factory:gate-pending',
      event({
        id: 12,
        payload: { from: 'factory:accepted', to: 'factory:gate-pending' },
        workItemId: 'github:owner/repo#gate-pending',
      }),
      'gate_pending',
    ],
    [
      'merge.conflict',
      event({
        id: 13,
        kind: 'merge.conflict',
        payload: { prNumber: 123 },
        workItemId: 'github:owner/repo#merge-conflict',
      }),
      'merge_conflict',
    ],
    [
      'factory:merge-conflict',
      event({
        id: 14,
        payload: { from: 'factory:approved', to: 'factory:merge-conflict' },
        workItemId: 'github:owner/repo#merge-state',
      }),
      'merge_conflict',
    ],
    [
      'factory:prd-review',
      event({
        id: 16,
        payload: { from: 'factory:prd-drafting', to: 'factory:prd-review' },
        workItemId: 'github:owner/repo#prd-review',
      }),
      'prd_review',
    ],
    [
      'qa.tier-disagreement',
      event({
        id: 15,
        kind: 'qa.tier-disagreement',
        payload: { deterministic: 'pass', qa: 'fail' },
        workItemId: 'github:owner/repo#qa-disagreement',
      }),
      'qa_disagreement',
    ],
  ])('opens %s as a durable intervention', (_label, input, interventionType) => {
    const result = projectActionableEvent(input);

    expect(result.opened?.ok).toBe(true);
    expect(result.shouldScheduleProposer).toBe(true);
    if (result.opened?.ok) {
      expect(result.opened.intervention.interventionType).toBe(interventionType);
      expect(result.opened.intervention.status).toBe('OPEN');
    }
  });

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

  it('is idempotent for repeated gate-pending replay events', () => {
    const first = projectActionableEvent(
      event({
        id: 111,
        workItemId: 'github:owner/repo#gate-replay',
        payload: { from: 'factory:accepted', to: 'factory:gate-pending' },
      }),
    );
    const replay = projectActionableEvent(
      event({
        id: 111,
        workItemId: 'github:owner/repo#gate-replay',
        payload: { from: 'factory:accepted', to: 'factory:gate-pending' },
      }),
    );

    expect(first.shouldScheduleProposer).toBe(true);
    expect(replay.shouldScheduleProposer).toBe(false);
    expect(
      listInterventions({ projectId: 'proj', workItemId: 'github:owner/repo#gate-replay' }),
    ).toHaveLength(1);
  });

  it('does not open interventions for grill gate-pending reply waits', () => {
    const workItemId = 'github:owner/repo#grill-gate-pending';
    const result = projectActionableEvent(
      event({
        id: 121,
        workItemId,
        payload: {
          from: 'factory:grilling',
          to: 'factory:gate-pending',
          by: 'grill-and-prd',
        },
      }),
    );

    expect(result.opened).toBeNull();
    expect(result.shouldScheduleProposer).toBe(false);
    expect(listInterventions({ projectId: 'proj', workItemId })).toHaveLength(0);
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
