import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { computeIsLive, computeIsWritePrdStuck, groupEvents } from './timeline';

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

describe('groupEvents — investigation runs', () => {
  it('leaves investigation, scout, and wave runs as ordinary run-groups', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-investigate:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(2, 'swarm.scout-completed', 'run-investigate:scout:pattern:0', {
        payload: { scoutName: 'scout-pattern', findingsCount: 1 },
      }),
      makeEvent(3, 'agent.run-completed', 'run-investigate:scout:pattern:0'),
      makeEvent(4, 'agent.run-started', 'run-investigate:scout:wave2-risk-analyst:1', {
        payload: { skill: 'wave2-risk-analyst' },
      }),
      makeEvent(5, 'swarm.wave-completed', 'run-investigate:scout:wave2-risk-analyst:1'),
      makeEvent(6, 'agent.run-completed', 'run-investigate:scout:wave2-risk-analyst:1'),
      makeEvent(7, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(8, 'agent.investigation-complete', 'run-investigate'),
      makeEvent(9, 'state.transitioned', null),
    ];

    const items = groupEvents(events);
    const runGroups = items.filter((item) => item.kind === 'run-group');

    expect(runGroups.map((item) => item.runId)).toEqual([
      'run-investigate',
      'run-investigate:scout:wave2-risk-analyst:1',
      'run-investigate:scout:pattern:0',
    ]);
    expect(
      items.some((item) => item.kind === 'event' && item.event.kind === 'state.transitioned'),
    ).toBe(true);
  });

  it('orders run-groups by latest activity, not start time', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(5, 'agent.run-started', 'run-investigate:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(6, 'agent.run-completed', 'run-investigate:scout:pattern:0'),
      makeEvent(10, 'agent.investigation-complete', 'run-investigate'),
    ];

    const items = groupEvents(events);
    const runGroups = items.filter((item) => item.kind === 'run-group');

    expect(runGroups.map((item) => item.runId)).toEqual([
      'run-investigate',
      'run-investigate:scout:pattern:0',
    ]);
  });

  it('uses start time and runId as stable tie-breakers for same-second activity', () => {
    const sameActivity = '2026-05-12T10:00:10Z';
    const sameStart = '2026-05-12T10:00:01Z';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-late-start', {
        payload: { skill: 'scout-schema' },
        createdAt: '2026-05-12T10:00:02Z',
      }),
      makeEvent(2, 'swarm.heartbeat', 'run-late-start', { createdAt: sameActivity }),
      makeEvent(3, 'agent.run-started', 'run-early-start', {
        payload: { skill: 'scout-pattern' },
        createdAt: '2026-05-12T10:00:01Z',
      }),
      makeEvent(4, 'swarm.heartbeat', 'run-early-start', { createdAt: sameActivity }),
      makeEvent(5, 'agent.run-started', 'run-z', {
        payload: { skill: 'scout-code-path' },
        createdAt: sameStart,
      }),
      makeEvent(6, 'swarm.heartbeat', 'run-z', { createdAt: sameActivity }),
      makeEvent(7, 'agent.run-started', 'run-a', {
        payload: { skill: 'scout-user-journey' },
        createdAt: sameStart,
      }),
      makeEvent(8, 'swarm.heartbeat', 'run-a', { createdAt: sameActivity }),
    ];

    const items = groupEvents(events);
    const runGroups = items.filter((item) => item.kind === 'run-group');

    expect(runGroups.map((item) => item.runId)).toEqual([
      'run-a',
      'run-early-start',
      'run-z',
      'run-late-start',
    ]);
  });
});

describe('computeIsLive', () => {
  it('returns false when no events', () => {
    expect(computeIsLive([])).toBe(false);
  });

  it('returns false when no agent.run-started', () => {
    expect(computeIsLive([makeEvent(1, 'state.transitioned', null)])).toBe(false);
  });

  it('returns true when run-started with no terminal event after', () => {
    expect(
      computeIsLive([makeEvent(1, 'agent.run-started', 'r1'), makeEvent(2, 'agent.spawned', 'r1')]),
    ).toBe(true);
  });

  it('returns false when run-started followed by agent.run-completed', () => {
    expect(
      computeIsLive([
        makeEvent(1, 'agent.run-started', 'r1'),
        makeEvent(2, 'agent.run-completed', 'r1'),
      ]),
    ).toBe(false);
  });

  it('returns false when run-started followed by prd.drafted', () => {
    expect(
      computeIsLive([makeEvent(1, 'agent.run-started', 'r1'), makeEvent(2, 'prd.drafted', 'r1')]),
    ).toBe(false);
  });
});

describe('computeIsWritePrdStuck', () => {
  it('returns false when no agent.run-completed for write-prd', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
      ]),
    ).toBe(false);
  });

  it('returns false when write-prd completed AND prd.drafted present', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.run-completed', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(3, 'prd.drafted', 'r1'),
      ]),
    ).toBe(false);
  });

  it('returns true when write-prd completed with no prd.drafted and not live', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.run-completed', 'r1', { payload: { skill: 'write-prd' } }),
      ]),
    ).toBe(true);
  });

  it('returns false when write-prd still running (live)', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.log', 'r1'),
      ]),
    ).toBe(false);
  });

  it('returns true even when agent.run-failed present', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.run-completed', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(3, 'agent.run-failed', 'r1', { payload: { skill: 'write-prd' } }),
      ]),
    ).toBe(true);
  });
});
