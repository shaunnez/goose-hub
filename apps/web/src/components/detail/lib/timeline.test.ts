import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import {
  EVENT_KIND_LABEL,
  computeIsLive,
  computeIsWritePrdStuck,
  groupByDevPhase,
  groupEvents,
} from './timeline';

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
  it('wraps investigation, scout, and wave runs into an investigation phase', () => {
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
    const phase = items.find((item) => item.kind === 'investigation-phase');

    expect(phase).toBeDefined();
    expect(phase?.kind).toBe('investigation-phase');
    if (phase?.kind === 'investigation-phase') {
      expect(phase.investigationRunId).toBe('run-investigate');
      expect(phase.status).toBe('completed');
      expect(
        phase.items
          .filter((item) => item.kind === 'run-group')
          .map((item) => (item.kind === 'run-group' ? item.runId : null)),
      ).toEqual([
        'run-investigate',
        'run-investigate:scout:wave2-risk-analyst:1',
        'run-investigate:scout:pattern:0',
      ]);
    }
    expect(
      items.some((item) => item.kind === 'event' && item.event.kind === 'state.transitioned'),
    ).toBe(true);
  });

  it('orders investigation phases by latest activity, not start time', () => {
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
    const phase = items.find((item) => item.kind === 'investigation-phase');

    expect(phase?.kind).toBe('investigation-phase');
    if (phase?.kind === 'investigation-phase') {
      expect(phase.investigationRunId).toBe('run-investigate');
      expect(phase.lastEventAt).toBe(events[3].createdAt);
    }
  });

  it('leaves orphan scout runs flat when no parent investigation run exists', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-missing:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(2, 'agent.run-completed', 'run-missing:scout:pattern:0'),
    ];

    const items = groupEvents(events);

    expect(items.some((item) => item.kind === 'investigation-phase')).toBe(false);
    expect(items[0]?.kind).toBe('run-group');
  });

  it('marks an investigation phase as started before child runs appear', () => {
    const items = groupEvents([
      makeEvent(1, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
    ]);

    const phase = items[0];
    expect(phase?.kind).toBe('investigation-phase');
    if (phase?.kind === 'investigation-phase') {
      expect(phase.status).toBe('started');
    }
  });

  it('marks an investigation phase as live when children are running', () => {
    const items = groupEvents([
      makeEvent(1, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(2, 'agent.run-started', 'run-investigate:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
    ]);

    const phase = items[0];
    expect(phase?.kind).toBe('investigation-phase');
    if (phase?.kind === 'investigation-phase') {
      expect(phase.status).toBe('live');
    }
  });

  it('marks an investigation phase as failed on wave halt', () => {
    const items = groupEvents([
      makeEvent(1, 'agent.run-started', 'run-investigate', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(2, 'swarm.wave-halted', 'run-investigate', {
        payload: { failedScouts: ['scout-schema'] },
      }),
    ]);

    const phase = items[0];
    expect(phase?.kind).toBe('investigation-phase');
    if (phase?.kind === 'investigation-phase') {
      expect(phase.status).toBe('failed');
    }
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

describe('groupByDevPhase', () => {
  it('returns items unchanged when no spec.completed event exists', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'state.transitioned', null),
      makeEvent(2, 'agent.run-started', 'run-abc', { payload: { skill: 'investigate' } }),
      makeEvent(3, 'agent.run-completed', 'run-abc'),
    ];
    const grouped = groupEvents(events);
    const result = groupByDevPhase(grouped);
    expect(result).toHaveLength(grouped.length);
    expect(result.some((item) => item.kind === 'phase-group')).toBe(false);
  });

  it('wraps spec.completed + WP runs + pipeline events into a phase-group', () => {
    const PID = 'pipe-xyz-123';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, {
        payload: { pipelineRunId: PID, workItemId: 'github:org/repo#1' },
      }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'parallel-implement.iteration-started', null, {
        payload: { pipelineRunId: PID, iteration: 1, wpCount: 1, wpIds: ['WP1'] },
      }),
      makeEvent(5, 'agent.run-started', `${PID}:wp:WP1:iter:1`, {
        payload: { skill: 'developer' },
      }),
      makeEvent(6, 'parallel-implement.wp-started', `${PID}:wp:WP1:iter:1`, {
        payload: { pipelineRunId: PID, wpId: 'WP1' },
      }),
      makeEvent(7, 'agent.run-completed', `${PID}:wp:WP1:iter:1`),
      makeEvent(8, 'state.transitioned', null),
    ];

    const grouped = groupEvents(events);
    const result = groupByDevPhase(grouped);

    const phaseGroups = result.filter((item) => item.kind === 'phase-group');
    expect(phaseGroups).toHaveLength(1);

    const pg = phaseGroups[0] as Extract<(typeof phaseGroups)[0], { kind: 'phase-group' }>;
    expect(pg.phase).toBe('dev');
    expect(pg.pipelineRunId).toBe(PID);

    const ungrouped = result.filter((item) => item.kind !== 'phase-group');
    expect(
      ungrouped.some((item) => item.kind === 'event' && item.event.kind === 'state.transitioned'),
    ).toBe(true);
  });

  it('groups WP run-groups by nested pipelineRunId when their runId uses the parallel run prefix', () => {
    const PID = 'pipe-ui-123';
    const WP_RUN = 'parallel-run-456:wp:WP1:iter:1';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'parallel-implement.iteration-started', 'parallel-run-456', {
        payload: { pipelineRunId: PID, iteration: 1, wpCount: 1, wpIds: ['WP1'] },
      }),
      makeEvent(5, 'agent.run-started', WP_RUN, { payload: { skill: 'implement-wp' } }),
      makeEvent(6, 'parallel-implement.wp-started', WP_RUN, {
        payload: { pipelineRunId: PID, wpId: 'WP1', wpRunId: WP_RUN },
      }),
    ];

    const result = groupEvents(events);
    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;

    expect(pg).toBeDefined();
    expect(pg.status).toBe('live');
    expect(pg.items.some((item) => item.kind === 'run-group' && item.runId === WP_RUN)).toBe(true);
    expect(result.some((item) => item.kind === 'run-group' && item.runId === WP_RUN)).toBe(false);
  });

  it('marks dev phase completed when the pipeline transitions to QA', () => {
    const PID = 'pipe-complete-123';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'state.transitioned', PID, {
        payload: { pipelineRunId: PID, to: 'factory:needs-qa' },
      }),
    ];

    const result = groupEvents(events);
    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;

    expect(pg.status).toBe('completed');
  });

  it('marks dev phase failed when parallel implement exhausts', () => {
    const PID = 'pipe-failed-123';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'parallel-implement.exhausted', 'parallel-run-456', {
        payload: { pipelineRunId: PID, failedWpIds: ['WP1'] },
      }),
    ];

    const result = groupEvents(events);
    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;

    expect(pg.status).toBe('failed');
  });

  it('groups dev-review.* events with matching pipelineRunId into the phase-group', () => {
    const PID = 'pipe-review-456';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'dev-review.started', null, { payload: { pipelineRunId: PID } }),
      makeEvent(5, 'dev-review.completed', null, {
        payload: { pipelineRunId: PID, verdict: 'proceed' },
      }),
      makeEvent(6, 'state.transitioned', null),
    ];

    const grouped = groupEvents(events);
    const result = groupByDevPhase(grouped);

    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;
    expect(pg).toBeDefined();

    const phaseEventKinds = pg.items
      .filter((item) => item.kind === 'event')
      .map((item) => (item as Extract<typeof item, { kind: 'event' }>).event.kind);

    expect(phaseEventKinds).toContain('dev-review.started');
    expect(phaseEventKinds).toContain('dev-review.completed');
  });

  it('groups legacy fix-feedback repair cycles with matching pipelineRunId into the dev phase', () => {
    const PID = 'pipe-repair-123';
    const REPAIR_RUN = 'repair-run-1';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'parallel-implement.wp-started', `${PID}:wp:WP1:iter:1`, {
        payload: { pipelineRunId: PID, wpId: 'WP1' },
      }),
      makeEvent(5, 'agent.run-started', REPAIR_RUN, { payload: { skill: 'implement' } }),
      makeEvent(6, 'agent.fix-feedback-complete', REPAIR_RUN, {
        payload: {
          pipelineRunId: PID,
          repairMode: 'legacy-implement',
          repairCycle: 1,
          sourceFailureKind: 'qa',
          sourceFailureRunId: 'qa-run-1',
          worktreePath: '/work/wt',
        },
      }),
      makeEvent(7, 'agent.run-completed', REPAIR_RUN),
    ];

    const result = groupEvents(events);
    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;

    expect(pg).toBeDefined();
    expect(pg.items.some((item) => item.kind === 'run-group' && item.runId === REPAIR_RUN)).toBe(
      true,
    );
    expect(result.some((item) => item.kind === 'run-group' && item.runId === REPAIR_RUN)).toBe(
      false,
    );
  });

  it('leaves fix-feedback repair events ungrouped when pipelineRunId is missing', () => {
    const PID = 'pipe-repair-missing-pid';
    const REPAIR_RUN = 'repair-run-missing-pid';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'agent.run-started', REPAIR_RUN, { payload: { skill: 'implement' } }),
      makeEvent(5, 'agent.fix-feedback-complete', REPAIR_RUN, {
        payload: {
          repairMode: 'legacy-implement',
          repairCycle: 1,
          worktreePath: '/work/wt',
        },
      }),
      makeEvent(6, 'agent.run-completed', REPAIR_RUN),
    ];

    const result = groupEvents(events);
    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;

    expect(pg).toBeDefined();
    expect(pg.items.some((item) => item.kind === 'run-group' && item.runId === REPAIR_RUN)).toBe(
      false,
    );
    expect(result.some((item) => item.kind === 'run-group' && item.runId === REPAIR_RUN)).toBe(
      true,
    );
  });
});

describe('EVENT_KIND_LABEL — dev-review kinds', () => {
  const DEV_REVIEW_KINDS = [
    'dev-review.started',
    'dev-review.completed',
    'dev-review.failed',
    'dev-review.error',
    'dev-review.budget-skipped',
    'dev-review.response-started',
    'dev-review.response-completed',
    'dev-review.response-failed',
  ] as const;

  it.each(DEV_REVIEW_KINDS)('has a label for %s', (kind) => {
    expect(EVENT_KIND_LABEL[kind]).toBeDefined();
    expect(typeof EVENT_KIND_LABEL[kind]).toBe('string');
    expect(EVENT_KIND_LABEL[kind].length).toBeGreaterThan(0);
  });
});

describe('EVENT_KIND_LABEL — QA and fix-feedback kinds', () => {
  const KINDS = [
    'agent.disclosure',
    'agent.fix-feedback-complete',
    'agent.retry-escalated',
    'evidence.playwright-ran',
    'qa.structural-passed',
    'qa.functional-passed',
    'qa.regression-passed',
  ] as const;

  it.each(KINDS)('has a label for %s', (kind) => {
    expect(EVENT_KIND_LABEL[kind]).toBeDefined();
    expect(typeof EVENT_KIND_LABEL[kind]).toBe('string');
    expect(EVENT_KIND_LABEL[kind].length).toBeGreaterThan(0);
  });
});
