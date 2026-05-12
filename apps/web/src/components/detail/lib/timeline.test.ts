import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { groupEvents } from './timeline';

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

describe('groupEvents — phase grouping', () => {
  it('wraps investigation run-groups in a single phase-group', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-scout', {
        payload: { skill: 'investigate-scout-pattern' },
      }),
      makeEvent(2, 'swarm.scout-completed', 'run-scout', {
        payload: { scoutName: 'scout-pattern', findingsCount: 1 },
      }),
      makeEvent(3, 'agent.run-completed', 'run-scout'),
      makeEvent(4, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(5, 'agent.investigation-complete', 'run-investigate'),
      makeEvent(6, 'state.transitioned', null),
    ];

    const items = groupEvents(events);
    const phaseGroup = items.find((i) => i.kind === 'phase-group');
    expect(phaseGroup).toBeDefined();
    expect(phaseGroup?.kind).toBe('phase-group');

    // Both investigation run-groups are inside the phase-group
    const children = (phaseGroup as Extract<(typeof items)[number], { kind: 'phase-group' }>).items;
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.kind === 'run-group')).toBe(true);

    // state.transitioned is outside the phase-group
    const stateItem = items.find(
      (i) => i.kind === 'event' && i.event.kind === 'state.transitioned',
    );
    expect(stateItem).toBeDefined();
  });

  it('does not create a phase-group when no investigation events exist', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-triage', { payload: { skill: 'triage' } }),
      makeEvent(2, 'agent.triage-complete', 'run-triage'),
      makeEvent(3, 'state.transitioned', null),
    ];

    const items = groupEvents(events);
    expect(items.every((i) => i.kind !== 'phase-group')).toBe(true);
  });
});
