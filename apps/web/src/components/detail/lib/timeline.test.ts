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
      makeEvent(1, 'agent.run-started', 'run-investigate:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(2, 'swarm.scout-completed', 'run-investigate:scout:pattern:0', {
        payload: { scoutName: 'scout-pattern', findingsCount: 1 },
      }),
      makeEvent(3, 'agent.run-completed', 'run-investigate:scout:pattern:0'),
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

  it('groups live scout-* run (no swarm events yet) inside phase-group', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-investigate:scout:user-journey:0', {
        payload: { skill: 'scout-user-journey' },
      }),
      makeEvent(2, 'agent.log', 'run-investigate:scout:user-journey:0'),
      makeEvent(3, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(4, 'agent.investigation-complete', 'run-investigate'),
    ];

    const items = groupEvents(events);
    const phaseGroup = items.find((i) => i.kind === 'phase-group');
    expect(phaseGroup).toBeDefined();
    const children = (phaseGroup as Extract<(typeof items)[number], { kind: 'phase-group' }>).items;
    expect(children).toHaveLength(2);
    expect(children.some((c) => c.kind === 'run-group' && c.skill === 'scout-user-journey')).toBe(
      true,
    );
  });

  it('groups live wave2-* run (no swarm events yet) inside phase-group', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-investigate:scout:wave2-risk-analyst:5', {
        payload: { skill: 'wave2-risk-analyst' },
      }),
      makeEvent(2, 'agent.log', 'run-investigate:scout:wave2-risk-analyst:5'),
      makeEvent(3, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(4, 'agent.investigation-complete', 'run-investigate'),
    ];

    const items = groupEvents(events);
    const phaseGroup = items.find((i) => i.kind === 'phase-group');
    expect(phaseGroup).toBeDefined();
    const children = (phaseGroup as Extract<(typeof items)[number], { kind: 'phase-group' }>).items;
    expect(children).toHaveLength(2);
    expect(children.some((c) => c.kind === 'run-group' && c.skill === 'wave2-risk-analyst')).toBe(
      true,
    );
  });

  it('creates separate phase-groups for two independent investigation runs', () => {
    // Run A: parentRunId = 'run-A'
    // Run B: parentRunId = 'run-B'
    const events: AgentEventDto[] = [
      // Run A — investigate anchor
      makeEvent(1, 'agent.run-started', 'run-A', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(2, 'agent.investigation-complete', 'run-A'),
      makeEvent(3, 'agent.run-completed', 'run-A'),
      // Run A — scout (runId follows ${parentRunId}:scout:${name}:${idx} pattern)
      makeEvent(4, 'agent.run-started', 'run-A:scout:code-path:0', {
        payload: { skill: 'scout-code-path' },
      }),
      makeEvent(5, 'swarm.scout-completed', 'run-A:scout:code-path:0', {
        payload: { scoutName: 'scout-code-path', findingsCount: 3 },
      }),
      makeEvent(6, 'agent.run-completed', 'run-A:scout:code-path:0'),
      // Unrelated state event between runs
      makeEvent(7, 'state.transitioned', null),
      // Run B — investigate anchor
      makeEvent(8, 'agent.run-started', 'run-B', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(9, 'agent.investigation-complete', 'run-B'),
      makeEvent(10, 'agent.run-completed', 'run-B'),
      // Run B — scout
      makeEvent(11, 'agent.run-started', 'run-B:scout:pattern:1', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(12, 'swarm.scout-completed', 'run-B:scout:pattern:1', {
        payload: { scoutName: 'scout-pattern', findingsCount: 1 },
      }),
      makeEvent(13, 'agent.run-completed', 'run-B:scout:pattern:1'),
    ];

    const items = groupEvents(events);
    const phaseGroups = items.filter((i) => i.kind === 'phase-group');

    // Two separate phase-groups, one per investigation run
    expect(phaseGroups).toHaveLength(2);

    type PhaseGroup = Extract<(typeof items)[number], { kind: 'phase-group' }>;

    const groupA = phaseGroups.find((g) =>
      (g as PhaseGroup).items.some((c) => c.kind === 'run-group' && c.runId === 'run-A'),
    ) as PhaseGroup | undefined;
    const groupB = phaseGroups.find((g) =>
      (g as PhaseGroup).items.some((c) => c.kind === 'run-group' && c.runId === 'run-B'),
    ) as PhaseGroup | undefined;

    expect(groupA).toBeDefined();
    expect(groupB).toBeDefined();

    // Run A's scout is only in group A
    expect(
      groupA?.items.some((c) => c.kind === 'run-group' && c.runId === 'run-A:scout:code-path:0'),
    ).toBe(true);
    expect(
      groupB?.items.some((c) => c.kind === 'run-group' && c.runId === 'run-A:scout:code-path:0'),
    ).toBe(false);

    // Run B's scout is only in group B
    expect(
      groupB?.items.some((c) => c.kind === 'run-group' && c.runId === 'run-B:scout:pattern:1'),
    ).toBe(true);
    expect(
      groupA?.items.some((c) => c.kind === 'run-group' && c.runId === 'run-B:scout:pattern:1'),
    ).toBe(false);

    // state.transitioned is outside both phase-groups
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
