import type { AgentEventDto, InterventionDto, InterventionEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import {
  EVENT_KIND_LABEL,
  type RenderItem,
  collectRunIdsForTimelineSection,
  computeIsLive,
  computeIsWritePrdStuck,
  groupByDevPhase,
  groupByReviewWorkflow,
  groupEvents,
  groupTimelineEventsByCanonicalSection,
} from './timeline';
import {
  compareTimelineChildrenForReading,
  effectiveTimestamp,
  itemLastEventAt,
  itemStartedAt,
} from './timeline/render-items';

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

function makeIntervention(overrides: Partial<InterventionDto> = {}): InterventionDto {
  return {
    id: 'intervention-123456789',
    projectId: 'proj',
    workItemId: 'item-1',
    interventionType: 'manual_override',
    status: 'RESOLVED',
    title: 'Manual operator transition',
    reason: 'Operator requested a transition',
    rootCauseSignature: 'manual:item-1',
    correlationId: 'corr-1',
    sourceEventId: null,
    proposedOptions: [],
    decidedActionType: 'manual_transition',
    decidedActionPayload: null,
    decidedBy: 'ui',
    decisionReason: 'manual operator transition',
    applicationResult: null,
    verification: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    version: 1,
    createdAt: '2026-05-04T10:00:00Z',
    updatedAt: '2026-05-04T10:03:00Z',
    resolvedAt: '2026-05-04T10:03:00Z',
    ...overrides,
  };
}

function makeInterventionEvent(
  id: number,
  eventType: string,
  createdAt: string,
  overrides: Partial<InterventionEventDto> = {},
): InterventionEventDto {
  return {
    id,
    interventionId: 'intervention-123456789',
    projectId: 'proj',
    workItemId: 'item-1',
    eventType,
    actor: 'ui',
    fromStatus: null,
    toStatus: null,
    payload: {},
    correlationId: 'corr-1',
    createdAt,
    ...overrides,
  };
}

describe('groupEvents — intervention groups', () => {
  it('sorts intervention groups by latest visible lifecycle activity', () => {
    const olderEvent = makeEvent(1, 'system.note', null, {
      createdAt: '2026-05-04T10:01:00Z',
    });
    const newerEvent = makeEvent(2, 'system.note', null, {
      createdAt: '2026-05-04T10:05:00Z',
    });
    const intervention = makeIntervention();
    const interventionEvents = [
      makeInterventionEvent(1, 'open', '2026-05-04T10:02:00Z'),
      makeInterventionEvent(2, 'resolve', '2026-05-04T10:03:00Z'),
    ];

    const result = groupEvents(
      [olderEvent, newerEvent],
      [{ intervention, events: interventionEvents }],
    );

    expect(result.map((item) => item.kind)).toEqual(['event', 'intervention-group', 'event']);
    if (result[1].kind === 'intervention-group') {
      expect(result[1].startedAt).toBe('2026-05-04T10:02:00Z');
      expect(result[1].lastEventAt).toBe('2026-05-04T10:03:00Z');
      expect(result[1].endedAt).toBe(intervention.resolvedAt);
    }
  });

  it('filters noisy intervention events before rendering', () => {
    const result = groupEvents(
      [],
      [
        {
          intervention: makeIntervention(),
          events: [
            makeInterventionEvent(1, 'open', '2026-05-04T10:00:00Z'),
            makeInterventionEvent(2, 'dedupe', '2026-05-04T10:01:00Z'),
            makeInterventionEvent(3, 'leaseProposal', '2026-05-04T10:02:00Z'),
            makeInterventionEvent(4, 'decide', '2026-05-04T10:03:00Z'),
          ],
        },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('intervention-group');
    if (result[0].kind === 'intervention-group') {
      expect(result[0].events.map((event) => event.eventType)).toEqual(['open', 'decide']);
      expect(result[0].lastEventAt).toBe('2026-05-04T10:03:00Z');
    }
  });
});

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

  it('infers an investigation phase from scout child run ids', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', 'run-missing:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(2, 'agent.run-completed', 'run-missing:scout:pattern:0'),
    ];

    const items = groupEvents(events);

    const phase = items[0];
    expect(phase?.kind).toBe('investigation-phase');
    if (phase?.kind === 'investigation-phase') {
      expect(phase.investigationRunId).toBe('run-missing');
      expect(
        phase.items.some(
          (item) => item.kind === 'run-group' && item.runId === 'run-missing:scout:pattern:0',
        ),
      ).toBe(true);
    }
  });

  it('infers a live investigation phase from a partial swarm window', () => {
    const parentRunId = 'run-investigate-partial';
    const wave2RiskRunId = `${parentRunId}:scout:wave2-risk-analyst:1`;
    const wave2UxRunId = `${parentRunId}:scout:wave2-ux-scout:2`;
    const events: AgentEventDto[] = [
      makeEvent(1, 'swarm.heartbeat', parentRunId, {
        payload: { parentRunId, wave: 2, activeScouts: [wave2RiskRunId, wave2UxRunId] },
      }),
      makeEvent(2, 'swarm.wave-completed', parentRunId, {
        payload: { parentRunId, wave: 1, completedScouts: ['scout-pattern'] },
      }),
      makeEvent(3, 'agent.run-started', wave2RiskRunId, {
        payload: { skill: 'wave2-risk-analyst' },
      }),
      makeEvent(4, 'swarm.heartbeat', wave2RiskRunId, {
        payload: { parentRunId, wave: 2, scoutName: 'wave2-risk-analyst' },
      }),
      makeEvent(5, 'agent.run-started', wave2UxRunId, {
        payload: { skill: 'wave2-ux-scout' },
      }),
      makeEvent(6, 'swarm.heartbeat', wave2UxRunId, {
        payload: { parentRunId, wave: 2, scoutName: 'wave2-ux-scout' },
      }),
    ];

    const items = groupEvents(events);
    const phases = items.filter((item) => item.kind === 'investigation-phase');

    expect(phases).toHaveLength(1);
    const phase = phases[0];
    expect(phase.kind).toBe('investigation-phase');
    if (phase.kind === 'investigation-phase') {
      expect(phase.investigationRunId).toBe(parentRunId);
      expect(phase.status).toBe('live');
      const childRunIds = phase.items
        .filter((item) => item.kind === 'run-group')
        .map((item) => (item.kind === 'run-group' ? item.runId : null));
      expect(childRunIds).toEqual(expect.arrayContaining([wave2RiskRunId, wave2UxRunId]));
    }
    expect(
      items.some(
        (item) => item.kind === 'run-group' && item.runId === parentRunId && item.skill == null,
      ),
    ).toBe(false);
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

  it('groups scout evidence retry events under the base scout run row', () => {
    const baseRunId = 'run-investigate:scout:scout-schema:0';
    const retryRunId = `${baseRunId}:evidence-retry`;
    const items = groupEvents([
      makeEvent(1, 'agent.run-started', baseRunId, {
        payload: { skill: 'scout-schema' },
      }),
      makeEvent(2, 'agent.run-completed', baseRunId),
      makeEvent(3, 'agent.run-started', retryRunId, {
        payload: { skill: 'scout-schema' },
      }),
      makeEvent(4, 'swarm.scout-skipped', retryRunId, {
        payload: { scoutName: 'scout-schema', skippedReason: 'No schema boundary applies' },
      }),
      makeEvent(5, 'agent.run-completed', retryRunId),
    ]);

    const phase = items.find((item) => item.kind === 'investigation-phase');
    expect(phase?.kind).toBe('investigation-phase');
    if (phase?.kind !== 'investigation-phase') return;
    const runGroups = phase.items.filter((item) => item.kind === 'run-group');
    expect(runGroups).toHaveLength(1);
    const [group] = runGroups;
    expect(group?.kind).toBe('run-group');
    if (group?.kind !== 'run-group') return;
    expect(group.runId).toBe(baseRunId);
    expect(
      group.items.some((item) => item.kind === 'event' && item.event.runId === retryRunId),
    ).toBe(true);
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

  it('returns false when parallel implement stops on a terminal WP blocker', () => {
    expect(
      computeIsLive([
        makeEvent(1, 'agent.run-started', 'r1'),
        makeEvent(2, 'parallel-implement.wp-terminal-blocked', 'r1'),
      ]),
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

describe('groupEvents — discover phase groups', () => {
  it('wraps grill child runs and parent grill workflow events into a grill phase', () => {
    const WID = 'discover-workflow-grill';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', `${WID}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: WID },
      }),
      makeEvent(2, 'agent.run-completed', `${WID}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: WID },
      }),
      makeEvent(3, 'grill.decision-crystallized', WID, {
        payload: {
          displaySkill: 'grill-me',
          workflowRunId: WID,
          roundNumber: 1,
          decision: 'Use the generic enhancement flow.',
        },
      }),
      makeEvent(4, 'grill.completed', WID, {
        payload: { displaySkill: 'grill-me', workflowRunId: WID, refinedIntent: 'Ship it.' },
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('phase-group');
    if (result[0].kind !== 'phase-group') return;
    expect(result[0].phase).toBe('grill');
    expect(result[0].pipelineRunId).toBe(WID);
    expect(result[0].status).toBe('completed');
    expect(
      result[0].items.some((item) => item.kind === 'run-group' && item.runId.endsWith(':grill-me')),
    ).toBe(true);
    expect(
      result[0].items.some(
        (item) => item.kind === 'event' && item.event.kind === 'grill.completed',
      ),
    ).toBe(true);
  });

  it('does not infer grill phase completion from a posted question alone', () => {
    const WID = 'discover-workflow-question-only';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', `${WID}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: WID },
      }),
      makeEvent(2, 'agent.run-completed', `${WID}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: WID },
      }),
      makeEvent(3, 'grill.question-posted', WID, {
        payload: { displaySkill: 'grill-me', workflowRunId: WID },
      }),
    ]);

    expect(result[0].kind).toBe('phase-group');
    if (result[0].kind !== 'phase-group') return;
    expect(result[0].phase).toBe('grill');
    expect(result[0].status).toBe('started');
  });

  it('wraps write-prd and advisor activity with parent PRD events into a PRD phase', () => {
    const WID = 'discover-workflow-prd';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', `${WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: WID },
      }),
      makeEvent(2, 'agent.run-completed', `${WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: WID },
      }),
      makeEvent(3, 'prd.advisor-skipped', WID, {
        payload: { workflowRunId: WID, reason: 'priority' },
      }),
      makeEvent(4, 'prd.drafted', WID, {
        payload: { displaySkill: 'write-prd', workflowRunId: WID, prd: { title: 'Draft' } },
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('phase-group');
    if (result[0].kind !== 'phase-group') return;
    expect(result[0].phase).toBe('prd');
    expect(result[0].pipelineRunId).toBe(WID);
    expect(result[0].status).toBe('completed');
    expect(
      result[0].items.some(
        (item) => item.kind === 'run-group' && item.runId.endsWith(':write-prd'),
      ),
    ).toBe(true);
    const prdEventKinds = result[0].items.flatMap((item) =>
      item.kind === 'event' ? [item.event.kind] : [],
    );
    expect(prdEventKinds).toEqual(expect.arrayContaining(['prd.advisor-skipped', 'prd.drafted']));
  });

  it('keeps Grill and PRD phases separate for the same discover workflow', () => {
    const WID = 'discover-workflow-complete';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', `${WID}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: WID },
      }),
      makeEvent(2, 'agent.run-completed', `${WID}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: WID },
      }),
      makeEvent(3, 'grill.completed', WID, {
        payload: { displaySkill: 'grill-me', workflowRunId: WID, refinedIntent: 'Draft it.' },
      }),
      makeEvent(4, 'agent.run-started', `${WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: WID },
      }),
      makeEvent(5, 'agent.run-completed', `${WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: WID },
      }),
      makeEvent(6, 'prd.drafted', WID, {
        payload: { displaySkill: 'write-prd', workflowRunId: WID, prd: { title: 'Draft' } },
      }),
    ]);

    const phaseGroups = result.filter((item) => item.kind === 'phase-group');
    expect(phaseGroups).toHaveLength(2);
    expect(phaseGroups.map((item) => (item.kind === 'phase-group' ? item.phase : null))).toEqual([
      'prd',
      'grill',
    ]);
  });

  it('collapses multiple Grill rounds with different workflow ids into one session phase', () => {
    const SID = 'discover-session-1';
    const W1 = 'discover-workflow-round-1';
    const W2 = 'discover-workflow-round-2';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', `${W1}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: W1, discoverSessionId: SID },
      }),
      makeEvent(2, 'agent.run-completed', `${W1}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: W1, discoverSessionId: SID },
      }),
      makeEvent(3, 'grill.question-posted', W1, {
        payload: { displaySkill: 'grill-me', workflowRunId: W1, discoverSessionId: SID },
      }),
      makeEvent(4, 'agent.run-started', `${W2}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: W2, discoverSessionId: SID },
      }),
      makeEvent(5, 'agent.run-completed', `${W2}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: W2, discoverSessionId: SID },
      }),
      makeEvent(6, 'grill.completed', W2, {
        payload: { displaySkill: 'grill-me', workflowRunId: W2, discoverSessionId: SID },
      }),
    ]);

    const phaseGroups = result.filter((item) => item.kind === 'phase-group');
    expect(phaseGroups).toHaveLength(1);
    const grill = phaseGroups[0];
    if (grill.kind !== 'phase-group') return;
    expect(grill.phase).toBe('grill');
    expect(grill.pipelineRunId).toBe(SID);
    expect(grill.idKind).toBe('session');
    expect(grill.items.filter((item) => item.kind === 'run-group')).toHaveLength(2);
  });

  it('nests manual Grill resume transitions and intervention groups in the session phase', () => {
    const SID = 'discover-session-manual';
    const WID = 'discover-workflow-manual';
    const intervention = makeIntervention({
      decidedActionPayload: {
        from: 'factory:gate-pending',
        to: 'factory:grilling',
        discoverSessionId: SID,
      },
      applicationResult: {
        ok: true,
        result: {
          from: 'factory:gate-pending',
          to: 'factory:grilling',
          discoverSessionId: SID,
        },
      },
    });
    const result = groupEvents(
      [
        makeEvent(1, 'grill.question-posted', WID, {
          payload: { displaySkill: 'grill-me', workflowRunId: WID, discoverSessionId: SID },
        }),
        makeEvent(2, 'state.transitioned', null, {
          payload: {
            from: 'factory:gate-pending',
            to: 'factory:grilling',
            by: 'ui',
            discoverSessionId: SID,
          },
        }),
      ],
      [
        {
          intervention,
          events: [
            makeInterventionEvent(1, 'open', '2026-05-04T10:00:00Z', {
              payload: { evidence: { discoverSessionId: SID } },
            }),
            makeInterventionEvent(2, 'decide', '2026-05-04T10:01:00Z', {
              payload: {
                actionType: 'manual_transition',
                actionPayload: { discoverSessionId: SID },
              },
            }),
          ],
        },
      ],
    );

    expect(result).toHaveLength(1);
    const grill = result[0];
    expect(grill.kind).toBe('phase-group');
    if (grill.kind !== 'phase-group') return;
    expect(grill.phase).toBe('grill');
    expect(grill.pipelineRunId).toBe(SID);
    expect(
      grill.items.some((item) => item.kind === 'event' && item.event.kind === 'state.transitioned'),
    ).toBe(true);
    expect(grill.items.some((item) => item.kind === 'intervention-group')).toBe(true);
  });

  it('keeps PRD separate from Grill while using the same discover session id', () => {
    const SID = 'discover-session-prd';
    const GRILL_WID = 'discover-workflow-grill-only';
    const PRD_WID = 'discover-workflow-prd-only';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', `${GRILL_WID}:grill-me`, {
        payload: { skill: 'grill-me', workflowRunId: GRILL_WID, discoverSessionId: SID },
      }),
      makeEvent(2, 'grill.completed', GRILL_WID, {
        payload: { displaySkill: 'grill-me', workflowRunId: GRILL_WID, discoverSessionId: SID },
      }),
      makeEvent(3, 'agent.run-started', `${PRD_WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: PRD_WID, discoverSessionId: SID },
      }),
      makeEvent(4, 'prd.drafted', PRD_WID, {
        payload: { displaySkill: 'write-prd', workflowRunId: PRD_WID, discoverSessionId: SID },
      }),
    ]);

    const phaseGroups = result.filter((item) => item.kind === 'phase-group');
    expect(phaseGroups).toHaveLength(2);
    expect(phaseGroups.map((item) => (item.kind === 'phase-group' ? item.phase : null))).toEqual([
      'prd',
      'grill',
    ]);
    for (const phase of phaseGroups) {
      if (phase.kind !== 'phase-group') continue;
      expect(phase.pipelineRunId).toBe(SID);
      expect(phase.idKind).toBe('session');
    }
  });

  it('hides grill reply manual actions from the timeline', () => {
    const result = groupEvents([
      makeEvent(1, 'manual.action', null, {
        payload: {
          action: 'comment',
          preview: '<!-- factory:grill-reply -->\nRecommended: Proceed.',
        },
      }),
      makeEvent(2, 'state.transitioned', null, {
        payload: { from: 'factory:gate-pending', to: 'factory:grilling', by: 'ui' },
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('event');
    if (result[0].kind === 'event') {
      expect(result[0].event.kind).toBe('state.transitioned');
    }
  });
});

describe('groupTimelineEventsByCanonicalSection', () => {
  function section(
    items: ReturnType<typeof groupTimelineEventsByCanonicalSection>,
    id: string,
  ): Extract<(typeof items)[number], { kind: 'timeline-section' }> | undefined {
    return items.find(
      (item): item is Extract<(typeof items)[number], { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === id,
    );
  }

  it('assigns raw events to canonical sections before section-specific grouping runs', () => {
    const WID = 'discover-canonical-prd';
    const PID = 'pipeline-canonical-1';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', `${WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: WID },
      }),
      makeEvent(2, 'agent.run-completed', `${WID}:write-prd`),
      makeEvent(3, 'prd.drafted', WID, { payload: { workflowRunId: WID } }),
      makeEvent(4, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(5, 'parallel-implement.wp-started', `${PID}:wp:WP1:iter:1`, {
        payload: { pipelineRunId: PID, wpId: 'WP1' },
      }),
    ]);

    const prd = section(items, 'prd');
    const delivery = items.find(
      (item): item is Extract<(typeof items)[number], { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'delivery-router',
    );
    const implementation = section(items, 'implementation');

    expect(prd?.items.some((item) => item.kind === 'phase-group')).toBe(false);
    expect(
      prd?.items.some((item) => item.kind === 'event' && item.event.kind === 'prd.drafted'),
    ).toBe(true);
    expect(delivery?.items.some((item) => item.kind === 'phase-group')).toBe(false);
    expect(
      delivery?.items.some((item) => item.kind === 'event' && item.event.kind === 'spec.completed'),
    ).toBe(true);
    expect(
      implementation?.items.some(
        (item) => item.kind === 'event' && item.event.kind === 'parallel-implement.wp-started',
      ),
    ).toBe(true);
    expect(
      implementation?.items
        .flatMap((item) => (item.kind === 'phase-group' ? item.items : [item]))
        .some((item) => item.kind === 'event' && item.event.kind === 'spec.completed'),
    ).toBe(false);
  });

  it('orders top-level timeline items by latest start time with transitions standalone', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'parallel-implement.wp-started', 'pipe-order:wp:WP1:iter:1', {
        payload: { pipelineRunId: 'pipe-order' },
      }),
      makeEvent(2, 'grill.completed', 'discover-order', {
        payload: { workflowRunId: 'discover-order' },
      }),
      makeEvent(3, 'review.completed', null, {
        payload: { reviewWorkflowRunId: 'review-order', verdict: 'approved' },
      }),
      makeEvent(4, 'unknown.future-event', null),
      makeEvent(5, 'state.transitioned', null),
    ]);

    expect(items.map((item) => (item.kind === 'timeline-section' ? item.section : null))).toEqual([
      null,
      'system',
      'review',
      'grill',
      'implementation',
    ]);
    expect(items[0]).toMatchObject({ kind: 'event', event: { kind: 'state.transitioned' } });
  });

  it('splits repeated implicit triage episodes by time gap and sorts newest first', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'triage-old', {
        createdAt: '2026-05-22T10:00:00Z',
        payload: { skill: 'triage' },
      }),
      makeEvent(2, 'agent.run-started', 'repo-old', {
        createdAt: '2026-05-22T10:00:20Z',
        payload: { skill: 'repo-match' },
      }),
      makeEvent(3, 'agent.run-started', 'triage-new', {
        createdAt: '2026-05-22T10:20:00Z',
        payload: { skill: 'triage' },
      }),
      makeEvent(4, 'agent.run-started', 'repo-new', {
        createdAt: '2026-05-22T10:20:20Z',
        payload: { skill: 'repo-match' },
      }),
    ]);

    const triageSegments = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'triage',
    );

    expect(triageSegments).toHaveLength(2);
    expect(collectRunIdsForTimelineSection(triageSegments[0].items)).toEqual(
      new Set(['triage-new', 'repo-new']),
    );
    expect(collectRunIdsForTimelineSection(triageSegments[1].items)).toEqual(
      new Set(['triage-old', 'repo-old']),
    );
  });

  it('sorts children inside a timeline segment by latest activity with earlier starts as ties', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'triage-run', {
        createdAt: '2026-05-22T21:07:39Z',
        payload: { skill: 'triage' },
      }),
      makeEvent(2, 'agent.run-completed', 'triage-run', {
        createdAt: '2026-05-22T21:08:08Z',
      }),
      makeEvent(3, 'agent.run-started', 'repo-run', {
        createdAt: '2026-05-22T21:07:58Z',
        payload: { skill: 'repo-match' },
      }),
      makeEvent(4, 'agent.run-completed', 'repo-run', {
        createdAt: '2026-05-22T21:08:04Z',
      }),
    ]);

    const triage = section(items, 'triage');
    expect(
      triage?.items.map((item) => (item.kind === 'run-group' ? item.runId : item.kind)),
    ).toEqual(['triage-run', 'repo-run']);
  });

  it('uses the latest log-group entry for timeline child activity ordering', () => {
    const logGroup: RenderItem = {
      kind: 'log-group',
      events: [
        makeEvent(1, 'agent.log', null, { createdAt: '2026-05-22T21:07:39Z' }),
        makeEvent(2, 'agent.log', null, { createdAt: '2026-05-22T21:08:09Z' }),
      ],
    };
    const runGroup: RenderItem = {
      kind: 'run-group',
      runId: 'completed-run',
      items: [],
      skill: 'triage',
      startedAt: '2026-05-22T21:07:50Z',
      endedAt: '2026-05-22T21:08:04Z',
      lastEventAt: '2026-05-22T21:08:04Z',
      personaId: null,
      modelId: null,
      runtime: null,
    };

    expect(effectiveTimestamp(logGroup)).toBe(new Date('2026-05-22T21:08:09Z').getTime());
    expect(itemStartedAt(logGroup)).toBe('2026-05-22T21:07:39Z');
    expect(itemLastEventAt(logGroup)).toBe('2026-05-22T21:08:09Z');
    expect([runGroup, logGroup].sort(compareTimelineChildrenForReading)).toEqual([
      logGroup,
      runGroup,
    ]);
  });

  it('keeps repeated Grill rounds together but splits PRD revisions by workflow run', () => {
    const SID = 'discover-session-canonical-loop';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'round-1:grill-me', {
        payload: { skill: 'grill-me', workflowRunId: 'round-1', discoverSessionId: SID },
      }),
      makeEvent(2, 'grill.completed', 'round-1', {
        payload: { workflowRunId: 'round-1', discoverSessionId: SID },
      }),
      makeEvent(3, 'prd.drafted', 'round-1', {
        payload: { workflowRunId: 'round-1', discoverSessionId: SID },
      }),
      makeEvent(4, 'agent.run-started', 'round-2:grill-me', {
        payload: { skill: 'grill-me', workflowRunId: 'round-2', discoverSessionId: SID },
      }),
      makeEvent(5, 'grill.completed', 'round-2', {
        payload: { workflowRunId: 'round-2', discoverSessionId: SID },
      }),
      makeEvent(6, 'prd.revised', 'round-2', {
        payload: { workflowRunId: 'round-2', discoverSessionId: SID },
      }),
    ]);

    expect(
      items.filter((item) => item.kind === 'timeline-section' && item.section === 'grill'),
    ).toHaveLength(1);
    const prdSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'prd',
    );
    expect(prdSections).toHaveLength(2);
    expect(section(items, 'grill')?.items.some((item) => item.kind === 'phase-group')).toBe(false);
    expect(prdSections[0].segmentId).toBe('prd:round-2');
    expect(prdSections[1].segmentId).toBe('prd:round-1');
    expect(
      section(items, 'grill')?.items.filter(
        (item) => item.kind === 'event' && item.event.kind === 'grill.completed',
      ),
    ).toHaveLength(2);
    expect(
      prdSections[0].items.filter(
        (item) => item.kind === 'event' && item.event.kind === 'prd.revised',
      ),
    ).toHaveLength(1);
  });

  it('attaches PRD review feedback to the next PRD workflow in the same discover session', () => {
    const SID = 'discover-session-prd-feedback';
    const FIRST_WID = 'prd-workflow-first';
    const SECOND_WID = 'prd-workflow-revision';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', `${FIRST_WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: FIRST_WID, discoverSessionId: SID },
      }),
      makeEvent(2, 'prd.drafted', FIRST_WID, {
        payload: { workflowRunId: FIRST_WID, discoverSessionId: SID },
      }),
      makeEvent(3, 'prd.revised', null, {
        payload: { source: 'ui', concerns: ['tighten scope'], discoverSessionId: SID },
      }),
      makeEvent(4, 'agent.run-started', `${SECOND_WID}:write-prd`, {
        payload: { skill: 'write-prd', workflowRunId: SECOND_WID, discoverSessionId: SID },
      }),
      makeEvent(5, 'prd.drafted', SECOND_WID, {
        payload: { workflowRunId: SECOND_WID, discoverSessionId: SID },
      }),
    ]);

    const prdSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'prd',
    );

    expect(prdSections.map((item) => item.segmentId)).toEqual([
      `prd:${SECOND_WID}`,
      `prd:${FIRST_WID}`,
    ]);
    expect(
      prdSections[0].items.some(
        (item) => item.kind === 'event' && item.event.kind === 'prd.revised',
      ),
    ).toBe(true);
    expect(collectRunIdsForTimelineSection(prdSections[0].items)).toEqual(
      new Set([`${SECOND_WID}:write-prd`, SECOND_WID]),
    );
  });

  it('flattens a single Grill phase and names sparse child runs from the section', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'sparse-grill-run', {
        payload: { workflowSection: 'grill', workflowRunId: 'discover-grill-sparse' },
      }),
      makeEvent(2, 'agent.log', 'sparse-grill-run', {
        payload: { workflowRunId: 'discover-grill-sparse', stream: 'stdout', line: 'question' },
      }),
      makeEvent(3, 'agent.log', 'sparse-grill-run', {
        payload: { workflowRunId: 'discover-grill-sparse', stream: 'stdout', line: 'answer' },
      }),
      makeEvent(4, 'grill.completed', 'sparse-grill-run', {
        payload: { workflowRunId: 'discover-grill-sparse' },
      }),
    ]);

    const grill = section(items, 'grill');
    expect(grill?.items.some((item) => item.kind === 'phase-group')).toBe(false);
    expect(grill?.items.find((item) => item.kind === 'run-group')).toMatchObject({
      kind: 'run-group',
      runId: 'sparse-grill-run',
      skill: 'grill-me',
    });
  });

  it('joins Grill runtime rows to discover session segments from workflow events', () => {
    const SID = 'discover-session-grill-join';
    const WID = 'discover-workflow-grill-join';
    const RUN = 'grill-runtime-run';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', RUN, {
        payload: { skill: 'grill-me', workflowRunId: WID },
      }),
      makeEvent(2, 'agent.log', RUN, {
        payload: { workflowRunId: WID, stream: 'stdout', line: 'question' },
      }),
      makeEvent(3, 'grill.question-posted', WID, {
        payload: { workflowRunId: WID, discoverSessionId: SID },
      }),
      makeEvent(4, 'agent.run-completed', RUN, {
        payload: { workflowRunId: WID },
      }),
      makeEvent(5, 'grill.completed', WID, {
        payload: { workflowRunId: WID, discoverSessionId: SID },
      }),
    ]);

    const grillSections = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'grill',
    );

    expect(grillSections).toHaveLength(1);
    expect(grillSections[0]?.segmentId).toBe(`grill:${SID}`);
    expect(grillSections[0]?.items.some((item) => item.kind === 'phase-group')).toBe(false);
    expect(grillSections[0]?.items.find((item) => item.kind === 'run-group')).toMatchObject({
      kind: 'run-group',
      runId: RUN,
      skill: 'grill-me',
    });
  });

  it('keeps investigation, review, and implementation details inside their sections', () => {
    const reviewRun = 'review-canonical';
    const pipelineRun = 'pipeline-canonical';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'investigate-canonical:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(2, 'swarm.scout-completed', 'investigate-canonical:scout:pattern:0', {
        payload: { parentRunId: 'investigate-canonical' },
      }),
      makeEvent(3, 'investigation.digest-applied', 'investigate-canonical', {
        payload: { wave: 'wave-1-to-synthesis', scoutCount: 2 },
      }),
      makeEvent(4, 'review.slot-completed', 'review-slot-canonical', {
        payload: { reviewWorkflowRunId: reviewRun, verdict: 'approved' },
      }),
      makeEvent(5, 'parallel-implement.wp-started', `${pipelineRun}:wp:WP1:iter:1`, {
        payload: { pipelineRunId: pipelineRun },
      }),
    ]);

    expect(
      section(items, 'investigation')?.items.some(
        (item) =>
          item.kind === 'run-group' && item.runId === 'investigate-canonical:scout:pattern:0',
      ),
    ).toBe(true);
    expect(
      section(items, 'investigation')?.items.some(
        (item) => item.kind === 'event' && item.event.kind === 'investigation.digest-applied',
      ),
    ).toBe(true);
    expect(section(items, 'review')?.items[0]).toMatchObject({ kind: 'event' });
    expect(
      section(items, 'review')?.items.some(
        (item) => item.kind === 'event' && item.event.kind === 'review.slot-completed',
      ),
    ).toBe(true);
    expect(section(items, 'implementation')?.items[0]).toMatchObject({ kind: 'event' });
    expect(
      section(items, 'implementation')?.items.some(
        (item) => item.kind === 'event' && item.event.kind === 'parallel-implement.wp-started',
      ),
    ).toBe(true);
  });

  it('keeps parallel implement parent and WP runs in one implementation pipeline accordion', () => {
    const PIPELINE_RUN = 'pipeline-implementation-123';
    const PARALLEL_RUN = 'parallel-implement-run-456';
    const WP_RUN = `${PARALLEL_RUN}:wp:WP1:iter:1`;
    const pipelineEvent = (
      id: number,
      kind: string,
      runId: string | null,
      payload: Record<string, unknown>,
    ) =>
      makeEvent(id, kind, runId, {
        payload: { ...payload, pipelineRunId: PIPELINE_RUN },
      });
    const items = groupTimelineEventsByCanonicalSection([
      pipelineEvent(1, 'parallel-implement.iteration-started', PARALLEL_RUN, {
        iteration: 1,
        wpCount: 1,
        wpIds: ['WP1'],
      }),
      makeEvent(3, 'agent.run-started', WP_RUN, {
        payload: { skill: 'implement-wp' },
      }),
      pipelineEvent(4, 'parallel-implement.wp-started', WP_RUN, {
        wpId: 'WP1',
        wpRunId: WP_RUN,
      }),
      makeEvent(5, 'agent.run-completed', WP_RUN),
      pipelineEvent(6, 'parallel-implement.wp-committed', WP_RUN, {
        wpId: 'WP1',
        wpRunId: WP_RUN,
        commitSha: 'abc1234',
      }),
      pipelineEvent(7, 'pr.opened', PARALLEL_RUN, {
        devRunId: PARALLEL_RUN,
        prNumber: 968,
      }),
      pipelineEvent(8, 'agent.run-completed', PARALLEL_RUN, {
        skill: 'parallel-implement',
        prNumber: 968,
      }),
    ]);

    const implementationSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'implementation',
    );
    expect(implementationSections).toHaveLength(1);
    expect(implementationSections[0].segmentId).toBe(`implementation:${PIPELINE_RUN}`);

    expect(implementationSections[0].items).toHaveLength(1);
    expect(implementationSections[0].items[0]).toMatchObject({
      kind: 'phase-group',
      phase: 'dev',
      pipelineRunId: PIPELINE_RUN,
    });
    const pipelineGroup = implementationSections[0].items[0];
    if (pipelineGroup.kind !== 'phase-group') return;

    expect(
      pipelineGroup.items.map((item) => (item.kind === 'run-group' ? item.runId : item.kind)),
    ).toEqual([PARALLEL_RUN, WP_RUN]);
    expect(
      pipelineGroup.items
        .flatMap((item) => (item.kind === 'run-group' ? item.items : [item]))
        .some((item) => item.kind === 'event' && item.event.kind === 'pr.opened'),
    ).toBe(true);
    expect(collectRunIdsForTimelineSection(implementationSections[0].items)).toEqual(
      new Set([PARALLEL_RUN, WP_RUN]),
    );
  });

  it('keeps parallel implement lifecycle completion in the implementation segment', () => {
    const PIPELINE_RUN = 'pipeline-lifecycle-123';
    const PARALLEL_RUN = 'parallel-implement-run-456';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'parallel-implement.iteration-started', PARALLEL_RUN, {
        payload: { pipelineRunId: PIPELINE_RUN, iteration: 1, wpCount: 1, wpIds: ['WP1'] },
      }),
      makeEvent(2, 'agent.run-started', PARALLEL_RUN, {
        payload: { skill: 'parallel-implement' },
      }),
      makeEvent(3, 'agent.run-completed', PARALLEL_RUN, {
        payload: { skill: 'parallel-implement', status: 'completed' },
      }),
    ]);

    expect(
      items.some((item) => item.kind === 'timeline-section' && item.section === 'system'),
    ).toBe(false);
    const implementationSection = section(items, 'implementation');
    expect(implementationSection?.segmentId).toBe(`implementation:${PIPELINE_RUN}`);
    expect(
      implementationSection?.items.some(
        (item) => item.kind === 'run-group' && item.runId === PARALLEL_RUN,
      ),
    ).toBe(true);
    expect(
      implementationSection?.items
        .flatMap((item) => (item.kind === 'run-group' ? item.items : [item]))
        .some((item) => item.kind === 'event' && item.event.kind === 'agent.run-completed'),
    ).toBe(true);
  });

  it('splits fix-feedback repair attempts from the original implementation pipeline segment', () => {
    const PIPELINE_RUN = 'pipeline-fix-feedback-123';
    const IMPLEMENT_RUN = 'parallel-implement-run-456';
    const FIX_RUN = 'fix-feedback-run-789';
    const ATTEMPT_ID = 'fix-feedback-attempt-1';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'parallel-implement.iteration-started', PIPELINE_RUN, {
        payload: { pipelineRunId: PIPELINE_RUN, iteration: 1 },
      }),
      makeEvent(2, 'agent.run-started', IMPLEMENT_RUN, {
        payload: { skill: 'implement-wp' },
      }),
      makeEvent(3, 'agent.run-completed', IMPLEMENT_RUN),
      makeEvent(4, 'pr.opened', PIPELINE_RUN, {
        payload: { pipelineRunId: PIPELINE_RUN, number: 971 },
      }),
      makeEvent(5, 'state.transitioned', FIX_RUN, {
        payload: {
          pipelineRunId: PIPELINE_RUN,
          attemptId: ATTEMPT_ID,
          from: 'factory:needs-fix',
          to: 'factory:in-progress',
          by: 'fix-feedback',
        },
      }),
      makeEvent(6, 'agent.run-started', FIX_RUN, {
        payload: {
          skill: 'implement',
          displaySkill: 'fix-feedback',
          workflowSkill: 'fix-feedback',
        },
      }),
      makeEvent(7, 'agent.fix-feedback-complete', FIX_RUN, {
        payload: {
          pipelineRunId: PIPELINE_RUN,
          attemptId: ATTEMPT_ID,
          repairCycle: 1,
        },
      }),
      makeEvent(8, 'agent.tool-call', FIX_RUN, {
        payload: { tool: 'read_file', status: 'ok' },
      }),
    ]);

    const implementationSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'implementation',
    );

    expect(implementationSections).toHaveLength(2);
    expect(implementationSections[0].segmentId).toBe(`implementation:fix-feedback:${ATTEMPT_ID}`);
    expect(implementationSections[1].segmentId).toBe(`implementation:${PIPELINE_RUN}`);
    expect(collectRunIdsForTimelineSection(implementationSections[0].items)).toEqual(
      new Set([FIX_RUN]),
    );
    expect(collectRunIdsForTimelineSection(implementationSections[1].items)).toEqual(
      new Set([PIPELINE_RUN, IMPLEMENT_RUN]),
    );
    expect(
      implementationSections[0].items.some(
        (item) =>
          item.kind === 'run-group' &&
          item.items.some(
            (child) => child.kind === 'event' && child.event.kind === 'agent.tool-call',
          ),
      ),
    ).toBe(true);
    expect(implementationSections[0].items[0]).toMatchObject({
      kind: 'run-group',
      runId: FIX_RUN,
      skill: 'fix-feedback',
    });
  });

  it('keeps model-retry runs inside the source fix-feedback repair attempt when later attempts exist', () => {
    const PIPELINE_RUN = 'pipeline-fix-feedback-retry';
    const FIRST_FIX_RUN = 'fix-feedback-run-first';
    const RETRY_RUN = 'fix-feedback-run-retry';
    const SECOND_FIX_RUN = 'fix-feedback-run-second';
    const FIRST_ATTEMPT_ID = 'fix-feedback-attempt-first';
    const SECOND_ATTEMPT_ID = 'fix-feedback-attempt-second';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'state.transitioned', FIRST_FIX_RUN, {
        payload: {
          pipelineRunId: PIPELINE_RUN,
          attemptId: FIRST_ATTEMPT_ID,
          from: 'factory:needs-fix',
          to: 'factory:in-progress',
          by: 'fix-feedback',
        },
      }),
      makeEvent(2, 'agent.run-started', FIRST_FIX_RUN, {
        payload: {
          skill: 'implement',
          displaySkill: 'fix-feedback',
          workflowSkill: 'fix-feedback',
        },
      }),
      makeEvent(3, 'agent.retry-escalated', RETRY_RUN, {
        payload: {
          runId: FIRST_FIX_RUN,
          retryRunId: RETRY_RUN,
          skill: 'implement',
          reason: 'schema-validation-failed',
        },
      }),
      makeEvent(4, 'agent.run-started', RETRY_RUN, {
        payload: {
          skill: 'implement',
          displaySkill: 'fix-feedback',
          workflowSkill: 'fix-feedback',
        },
      }),
      makeEvent(5, 'agent.run-completed', RETRY_RUN, {
        payload: { skill: 'implement' },
      }),
      makeEvent(6, 'agent.fix-feedback-complete', FIRST_FIX_RUN, {
        payload: {
          pipelineRunId: PIPELINE_RUN,
          attemptId: FIRST_ATTEMPT_ID,
          repairCycle: 1,
        },
      }),
      makeEvent(7, 'state.transitioned', SECOND_FIX_RUN, {
        payload: {
          pipelineRunId: PIPELINE_RUN,
          attemptId: SECOND_ATTEMPT_ID,
          from: 'factory:needs-fix',
          to: 'factory:in-progress',
          by: 'fix-feedback',
        },
      }),
    ]);

    const implementationSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'implementation',
    );
    const firstAttempt = implementationSections.find(
      (section) => section.segmentId === `implementation:fix-feedback:${FIRST_ATTEMPT_ID}`,
    );

    expect(firstAttempt).toBeDefined();
    expect(collectRunIdsForTimelineSection(firstAttempt?.items ?? [])).toEqual(
      new Set([FIRST_FIX_RUN, RETRY_RUN]),
    );
    expect(
      implementationSections.some(
        (section) => section.segmentId === `implementation:fix-feedback:${RETRY_RUN}`,
      ),
    ).toBe(false);
    expect(
      implementationSections.some((section) => section.segmentId === `implementation:${RETRY_RUN}`),
    ).toBe(false);
  });

  it('keeps qa completion in the qa run section when it carries only pipeline metadata', () => {
    const PIPELINE_RUN = 'pipeline-qa-123';
    const QA_RUN = 'qa-run-456';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', QA_RUN, { payload: { skill: 'qa' } }),
      makeEvent(2, 'agent.run-completed', QA_RUN),
      makeEvent(3, 'qa.completed', QA_RUN, {
        payload: { pipelineRunId: PIPELINE_RUN, verdict: 'pass', overallScore: 99, threshold: 70 },
      }),
    ]);

    const qaSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'qa',
    );

    expect(qaSections).toHaveLength(1);
    expect(qaSections[0].segmentId).toBe(`qa:${QA_RUN}`);
    expect(qaSections[0].items).toHaveLength(1);
    expect(qaSections[0].items[0]).toMatchObject({ kind: 'run-group', runId: QA_RUN });
    expect(collectRunIdsForTimelineSection(qaSections[0].items)).toEqual(new Set([QA_RUN]));
  });

  it('splits repeated QA attempts on the same pipeline into separate QA sections', () => {
    const PIPELINE_RUN = 'pipeline-qa-repeat';
    const QA_RUN_1 = 'qa-run-first';
    const QA_RUN_2 = 'qa-run-second';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'qa.structural-failed', QA_RUN_1, {
        payload: { pipelineRunId: PIPELINE_RUN, tier: 'structural' },
      }),
      makeEvent(2, 'qa.completed', QA_RUN_1, {
        payload: { pipelineRunId: PIPELINE_RUN, verdict: 'fail' },
      }),
      makeEvent(3, 'qa.structural-passed', QA_RUN_2, {
        payload: { pipelineRunId: PIPELINE_RUN, tier: 'structural' },
      }),
      makeEvent(4, 'qa.verification-blocked', QA_RUN_2, {
        payload: { pipelineRunId: PIPELINE_RUN, reason: 'verification-infrastructure-failure' },
      }),
    ]);

    const qaSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'qa',
    );

    expect(qaSections.map((item) => item.segmentId)).toEqual([`qa:${QA_RUN_2}`, `qa:${QA_RUN_1}`]);
    expect(collectRunIdsForTimelineSection(qaSections[0].items)).toEqual(new Set([QA_RUN_2]));
    expect(collectRunIdsForTimelineSection(qaSections[1].items)).toEqual(new Set([QA_RUN_1]));
  });

  it('keeps dev-review lifecycle and runtime rows in the pipeline dev-review section', () => {
    const PIPELINE_RUN = 'pipeline-dev-review-123';
    const DEV_REVIEW_RUN = 'dev-review-workflow-456:dev-review';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'dev-review.started', DEV_REVIEW_RUN, {
        payload: { runId: DEV_REVIEW_RUN, pipelineRunId: PIPELINE_RUN },
      }),
      makeEvent(2, 'agent.run-started', DEV_REVIEW_RUN, {
        payload: { skill: 'dev-review', runId: DEV_REVIEW_RUN },
      }),
      makeEvent(3, 'agent.run-completed', DEV_REVIEW_RUN, {
        payload: { skill: 'dev-review', runId: DEV_REVIEW_RUN },
      }),
      makeEvent(4, 'dev-review.completed', DEV_REVIEW_RUN, {
        payload: { runId: DEV_REVIEW_RUN, pipelineRunId: PIPELINE_RUN, verdict: 'no-blockers' },
      }),
    ]);

    const devReviewSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'dev-review',
    );

    expect(devReviewSections).toHaveLength(1);
    expect(devReviewSections[0].segmentId).toBe(`dev-review:${PIPELINE_RUN}`);
    expect(devReviewSections[0].items).toHaveLength(1);
    expect(devReviewSections[0].items[0]).toMatchObject({
      kind: 'run-group',
      runId: DEV_REVIEW_RUN,
      skill: 'dev-review',
      endedAt: expect.any(String),
    });
    expect(collectRunIdsForTimelineSection(devReviewSections[0].items)).toEqual(
      new Set([DEV_REVIEW_RUN]),
    );
  });

  it('keeps sparse reviewer runtime rows in the parent review workflow section', () => {
    const REVIEW_RUN = 'review-workflow-123';
    const SLOT_A = 'review-slot-a';
    const SLOT_B = 'review-slot-b';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', SLOT_A, { payload: { skill: 'review' } }),
      makeEvent(2, 'agent.run-started', SLOT_B, { payload: { skill: 'review' } }),
      makeEvent(3, 'review.wave-completed', REVIEW_RUN, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, round: 1, roundFindingsCount: 1 },
      }),
      makeEvent(4, 'review.slot-completed', SLOT_A, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, round: 1, slotIndex: 0, verdict: 'needs-fix' },
      }),
      makeEvent(5, 'review.slot-completed', SLOT_B, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, round: 1, slotIndex: 1, verdict: 'needs-fix' },
      }),
      makeEvent(6, 'agent.run-completed', SLOT_A),
      makeEvent(7, 'agent.run-completed', SLOT_B),
      makeEvent(8, 'review.completed', REVIEW_RUN, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, verdict: 'needs-fix' },
      }),
    ]);

    const reviewSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'review',
    );

    expect(reviewSections).toHaveLength(1);
    expect(reviewSections[0].segmentId).toBe(`review:${REVIEW_RUN}`);
    expect(reviewSections[0].items.some((item) => item.kind === 'review-group')).toBe(false);
    expect(collectRunIdsForTimelineSection(reviewSections[0].items)).toEqual(
      new Set([REVIEW_RUN, SLOT_A, SLOT_B]),
    );
  });

  it('renders review lifecycle-only run ids as event cards instead of unknown runs', () => {
    const REVIEW_RUN = 'review-workflow-lifecycle';
    const LIFECYCLE_RUN = 'review-lifecycle-run';
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'review.wave-completed', REVIEW_RUN, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, round: 1, roundFindingsCount: 1 },
      }),
      makeEvent(2, 'review.escalated', LIFECYCLE_RUN, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, reason: 'divergent-verdicts', round: 1 },
      }),
      makeEvent(3, 'review.completed', LIFECYCLE_RUN, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, verdict: 'needs-human', confidence: 0 },
      }),
    ]);

    const review = section(items, 'review');
    expect(review).toBeDefined();
    expect(
      review?.items.some((item) => item.kind === 'run-group' && item.runId === LIFECYCLE_RUN),
    ).toBe(false);
    expect(
      review?.items.filter(
        (item) =>
          item.kind === 'event' &&
          (item.event.kind === 'review.escalated' || item.event.kind === 'review.completed'),
      ),
    ).toHaveLength(2);
  });

  it('flattens redundant single investigation and contract phase wrappers', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'investigate-flat:scout:pattern:0', {
        payload: { skill: 'scout-pattern' },
      }),
      makeEvent(2, 'agent.run-completed', 'investigate-flat:scout:pattern:0'),
      makeEvent(3, 'agent.run-started', 'contract-flat', {
        payload: { skill: 'spec-author' },
      }),
      makeEvent(4, 'spec.completed', 'contract-flat', {
        payload: { pipelineRunId: 'contract-flat' },
      }),
    ]);

    expect(
      section(items, 'investigation')?.items.some((item) => item.kind === 'investigation-phase'),
    ).toBe(false);
    expect(section(items, 'investigation')?.items[0]).toMatchObject({
      kind: 'run-group',
      runId: 'investigate-flat:scout:pattern:0',
    });
    expect(
      section(items, 'delivery-router')?.items.some((item) => item.kind === 'phase-group'),
    ).toBe(false);
    expect(section(items, 'delivery-router')?.items[0]).toMatchObject({
      kind: 'run-group',
      runId: 'contract-flat',
    });
  });

  it('keeps spec-author structural repair retries in the same delivery-router section', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'spec-original', {
        payload: { skill: 'spec-author' },
      }),
      makeEvent(2, 'agent.run-completed', 'spec-original', {
        payload: { skill: 'spec-author' },
      }),
      makeEvent(3, 'agent.log', 'spec-original', {
        payload: {
          skill: 'spec-author',
          stream: 'validation',
          text: 'Spec author structural validation failed; retrying once.',
        },
      }),
      makeEvent(4, 'agent.run-started', 'spec-repair', {
        payload: {
          skill: 'spec-author',
          attempt: 'repair',
          repairOf: 'spec-original',
        },
      }),
      makeEvent(5, 'agent.run-completed', 'spec-repair', {
        payload: { skill: 'spec-author' },
      }),
      makeEvent(6, 'spec.completed', 'spec-repair', {
        payload: { pipelineRunId: 'spec-repair' },
      }),
    ]);

    const deliverySections = items.filter(
      (item) => item.kind === 'timeline-section' && item.section === 'delivery-router',
    );

    expect(deliverySections).toHaveLength(1);
    expect(collectRunIdsForTimelineSection(deliverySections[0]?.items ?? [])).toEqual(
      new Set(['spec-original', 'spec-repair']),
    );
  });

  it('combines proximate route decisions and acceptance contract runs into one delivery-router section', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'workflow.route-confirmed', null, {
        createdAt: '2026-06-03T10:36:20Z',
        payload: { tier: 'T2', source: 'investigation' },
      }),
      makeEvent(2, 'agent.run-started', 'acceptance-contract-run', {
        createdAt: '2026-06-03T10:36:23Z',
        payload: { skill: 'acceptance-contract' },
      }),
      makeEvent(3, 'acceptance.contract-authored', 'acceptance-contract-run', {
        createdAt: '2026-06-03T10:36:29Z',
        payload: { criteriaCount: 2 },
      }),
      makeEvent(4, 'agent.run-completed', 'acceptance-contract-run', {
        createdAt: '2026-06-03T10:36:29Z',
        payload: { skill: 'acceptance-contract' },
      }),
    ]);

    const deliverySections = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'delivery-router',
    );

    expect(deliverySections).toHaveLength(1);
    expect(
      deliverySections[0].items.some(
        (item) => item.kind === 'event' && item.event.kind === 'workflow.route-confirmed',
      ),
    ).toBe(true);
    expect(
      deliverySections[0].items.some(
        (item) => item.kind === 'run-group' && item.runId === 'acceptance-contract-run',
      ),
    ).toBe(true);
  });

  it('uses run-started metadata before grouping sparse runtime events', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-completed', 'run-prd-sparse'),
      makeEvent(2, 'agent.log', 'run-prd-sparse', { payload: { stream: 'stdout', line: 'work' } }),
      makeEvent(3, 'agent.tool-call', 'run-prd-sparse'),
      makeEvent(4, 'agent.budget-exceeded', 'run-prd-sparse'),
      makeEvent(5, 'agent.output-repair-failed', 'run-prd-sparse'),
      makeEvent(6, 'agent.run-started', 'run-prd-sparse', { payload: { skill: 'write-prd' } }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'timeline-section', section: 'prd' });
    if (items[0].kind !== 'timeline-section') return;
    expect(collectRunIdsForTimelineSection(items[0].items)).toEqual(new Set(['run-prd-sparse']));
  });

  it('keeps tool violations inside the owning runtime section', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'tool.violation', 'fix-feedback-with-violations', {
        payload: { tool: 'run_tests', reason: 'excessive-test-retries' },
      }),
      makeEvent(2, 'agent.run-started', 'fix-feedback-with-violations', {
        payload: {
          skill: 'implement',
          displaySkill: 'fix-feedback',
          workflowSkill: 'fix-feedback',
        },
      }),
    ]);

    expect(
      items.some((item) => item.kind === 'timeline-section' && item.section === 'system'),
    ).toBe(false);
    const implementation = items.find(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'implementation',
    );
    expect(implementation).toBeDefined();
    expect(
      implementation?.items.some(
        (item) =>
          item.kind === 'run-group' &&
          item.runId === 'fix-feedback-with-violations' &&
          item.items.some(
            (child) => child.kind === 'event' && child.event.kind === 'tool.violation',
          ),
      ),
    ).toBe(true);
  });

  it('keeps lazy bug-enhance runs inside investigation', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'bug-enhance-run', {
        payload: { skill: 'bug-enhance' },
      }),
      makeEvent(2, 'agent.tool-call', 'bug-enhance-run', {
        payload: { tool_name: 'read_file' },
      }),
      makeEvent(3, 'agent.run-completed', 'bug-enhance-run', {
        payload: { skill: 'bug-enhance' },
      }),
    ]);

    expect(
      items.some((item) => item.kind === 'timeline-section' && item.section === 'system'),
    ).toBe(false);
    const investigation = items.find(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'investigation',
    );
    expect(investigation).toBeDefined();
    expect(
      investigation?.items.some(
        (item) => item.kind === 'run-group' && item.runId === 'bug-enhance-run',
      ),
    ).toBe(true);
  });

  it('collapses lazy bug-enhance into its parent investigation section', () => {
    const investigationRunId = 'investigate-run';
    const bugEnhanceRunId = `${investigationRunId}:bug-enhance`;

    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', investigationRunId, {
        payload: { skill: 'investigate' },
      }),
      makeEvent(2, 'agent.run-started', bugEnhanceRunId, {
        payload: {
          skill: 'bug-enhance',
          parentRunId: investigationRunId,
          investigationRunId,
        },
      }),
      makeEvent(3, 'agent.tool-call', bugEnhanceRunId, {
        payload: { tool_name: 'read_file' },
      }),
      makeEvent(4, 'agent.run-completed', bugEnhanceRunId, {
        payload: { skill: 'bug-enhance' },
      }),
      makeEvent(5, 'agent.bug-enhance-lazy', investigationRunId, {
        payload: { producedSeed: true, candidateFileCount: 1 },
      }),
      makeEvent(6, 'agent.investigation-complete', investigationRunId),
    ]);

    const investigationSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'investigation',
    );

    expect(investigationSections).toHaveLength(1);
    expect(investigationSections[0].items.some((item) => item.kind === 'investigation-phase')).toBe(
      false,
    );
    expect(
      investigationSections[0].items.some(
        (item) => item.kind === 'run-group' && item.runId === investigationRunId,
      ),
    ).toBe(true);
    expect(
      investigationSections[0].items.some(
        (item) => item.kind === 'run-group' && item.runId === bugEnhanceRunId,
      ),
    ).toBe(true);
  });

  it('keeps lazy bug-enhance attached to the correct investigation when there are multiple runs', () => {
    const firstInvestigation = 'investigate-first';
    const secondInvestigation = 'investigate-second';

    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', firstInvestigation, {
        payload: { skill: 'investigate' },
      }),
      makeEvent(2, 'agent.run-started', `${firstInvestigation}:bug-enhance`, {
        payload: { skill: 'bug-enhance', parentRunId: firstInvestigation },
      }),
      makeEvent(3, 'agent.run-completed', `${firstInvestigation}:bug-enhance`),
      makeEvent(4, 'agent.investigation-complete', firstInvestigation),
      makeEvent(5, 'agent.run-started', secondInvestigation, {
        payload: { skill: 'investigate' },
      }),
      makeEvent(6, 'agent.run-started', `${secondInvestigation}:bug-enhance`, {
        payload: { skill: 'bug-enhance', parentRunId: secondInvestigation },
      }),
      makeEvent(7, 'agent.run-completed', `${secondInvestigation}:bug-enhance`),
      makeEvent(8, 'agent.investigation-complete', secondInvestigation),
    ]);

    const investigationSections = items.filter(
      (item): item is Extract<typeof item, { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'investigation',
    );

    expect(investigationSections).toHaveLength(2);
    const firstSection = investigationSections.find((section) =>
      section.items.some((item) => item.kind === 'run-group' && item.runId === firstInvestigation),
    );
    const secondSection = investigationSections.find((section) =>
      section.items.some((item) => item.kind === 'run-group' && item.runId === secondInvestigation),
    );

    expect(
      firstSection?.items.some(
        (item) => item.kind === 'run-group' && item.runId === `${firstInvestigation}:bug-enhance`,
      ),
    ).toBe(true);
    expect(
      secondSection?.items.some(
        (item) => item.kind === 'run-group' && item.runId === `${secondInvestigation}:bug-enhance`,
      ),
    ).toBe(true);
    expect(
      firstSection?.items.some(
        (item) => item.kind === 'run-group' && item.runId === `${secondInvestigation}:bug-enhance`,
      ),
    ).toBe(false);
  });

  it('keeps section cost attribution limited to runs inside that section', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'run-grill-cost', { payload: { skill: 'grill-me' } }),
      makeEvent(2, 'agent.run-started', 'run-prd-cost', { payload: { skill: 'write-prd' } }),
    ]);

    expect(collectRunIdsForTimelineSection(section(items, 'grill')?.items ?? [])).toEqual(
      new Set(['run-grill-cost']),
    );
    expect(collectRunIdsForTimelineSection(section(items, 'prd')?.items ?? [])).toEqual(
      new Set(['run-prd-cost']),
    );
  });

  it('lands unknown events under system', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'unknown.future-event', null),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'timeline-section', section: 'system' });
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
    expect(phaseGroups).toHaveLength(2);

    const contractGroup = phaseGroups.find(
      (item) => item.kind === 'phase-group' && item.phase === 'contract',
    ) as Extract<(typeof phaseGroups)[0], { kind: 'phase-group' }>;
    expect(contractGroup).toBeDefined();
    expect(
      contractGroup.items.some((item) => item.kind === 'run-group' && item.runId === PID),
    ).toBe(true);

    const pg = phaseGroups.find(
      (item) => item.kind === 'phase-group' && item.phase === 'dev',
    ) as Extract<(typeof phaseGroups)[0], { kind: 'phase-group' }>;
    expect(pg).toBeDefined();
    expect(pg.phase).toBe('dev');
    expect(pg.pipelineRunId).toBe(PID);
    expect(pg.items.some((item) => item.kind === 'run-group' && item.runId === PID)).toBe(false);

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

  it('marks dev phase failed when parallel implement hits a terminal WP blocker', () => {
    const PID = 'pipe-terminal-123';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'parallel-implement.wp-terminal-blocked', 'parallel-run-456:wp:WP1:iter:1', {
        payload: {
          pipelineRunId: PID,
          wpId: 'WP1',
          decisionKind: 'TOOL_FAILURE',
          errorReason: 'test harness unavailable',
        },
      }),
    ];

    const result = groupEvents(events);
    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;

    expect(pg.status).toBe('failed');
    expect(pg.endedAt).toBe(events[3].createdAt);
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

describe('groupEvents — convergent review runs', () => {
  it('groups reviewer child runs and review lifecycle events into one review-group', () => {
    const REVIEW_RUN = 'review-workflow-123';
    const SLOT_A = 'review-slot-a';
    const SLOT_B = 'review-slot-b';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', SLOT_A, {
        payload: { skill: 'review', reviewWorkflowRunId: REVIEW_RUN, round: 1, slotIndex: 0 },
      }),
      makeEvent(2, 'review.slot-completed', SLOT_A, {
        payload: {
          reviewWorkflowRunId: REVIEW_RUN,
          round: 1,
          slotIndex: 0,
          slotModel: 'claude',
          promptVariant: 'default',
          verdict: 'approved',
          confidence: 0.9,
          findingsCount: 0,
          criteriaChecks: [],
        },
      }),
      makeEvent(3, 'agent.run-started', SLOT_B, {
        payload: { skill: 'review', reviewWorkflowRunId: REVIEW_RUN, round: 1, slotIndex: 1 },
      }),
      makeEvent(4, 'review.slot-completed', SLOT_B, {
        payload: {
          reviewWorkflowRunId: REVIEW_RUN,
          round: 1,
          slotIndex: 1,
          slotModel: 'codex',
          promptVariant: 'unconstrained',
          verdict: 'approved',
          confidence: 0.85,
          findingsCount: 0,
          criteriaChecks: [],
        },
      }),
      makeEvent(5, 'review.wave-completed', null, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, round: 1, roundFindingsCount: 0 },
      }),
      makeEvent(6, 'review.converged', null, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, totalRounds: 1 },
      }),
      makeEvent(7, 'review.completed', null, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, verdict: 'approved', confidence: 0.88 },
      }),
      makeEvent(8, 'state.transitioned', null, {
        payload: { reviewWorkflowRunId: REVIEW_RUN, to: 'factory:approved' },
      }),
    ];

    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('review-group');
    if (result[0].kind !== 'review-group') return;

    expect(result[0].reviewWorkflowRunId).toBe(REVIEW_RUN);
    expect(result[0].status).toBe('completed');
    expect(result[0].items.some((item) => item.kind === 'run-group' && item.runId === SLOT_A)).toBe(
      true,
    );
    expect(result[0].items.some((item) => item.kind === 'run-group' && item.runId === SLOT_B)).toBe(
      true,
    );
    const parentEventKinds = result[0].items
      .filter((item) => item.kind === 'event')
      .map((item) => (item as Extract<typeof item, { kind: 'event' }>).event.kind);
    expect(parentEventKinds).toEqual(
      expect.arrayContaining([
        'review.wave-completed',
        'review.converged',
        'review.completed',
        'state.transitioned',
      ]),
    );
  });

  it('marks review-group terminal on review.completed needs-human', () => {
    const REVIEW_RUN = 'review-workflow-needs-human';
    const result = groupByReviewWorkflow([
      {
        kind: 'event',
        event: makeEvent(1, 'review.completed', null, {
          payload: { reviewWorkflowRunId: REVIEW_RUN, verdict: 'needs-human' },
        }),
      },
    ]);

    expect(result[0].kind).toBe('review-group');
    if (result[0].kind === 'review-group') {
      expect(result[0].status).toBe('needs-human');
      expect(result[0].endedAt).toBe(result[0].lastEventAt);
    }
  });

  it('marks review-group terminal on review-linked needs-human state transition', () => {
    const REVIEW_RUN = 'review-workflow-transition-needs-human';
    const result = groupByReviewWorkflow([
      {
        kind: 'event',
        event: makeEvent(1, 'state.transitioned', null, {
          payload: { reviewWorkflowRunId: REVIEW_RUN, to: 'factory:needs-human' },
        }),
      },
    ]);

    expect(result[0].kind).toBe('review-group');
    if (result[0].kind === 'review-group') {
      expect(result[0].status).toBe('needs-human');
      expect(result[0].endedAt).toBe(result[0].lastEventAt);
    }
  });

  it('keeps review grouping separate from dev phase grouping when review events carry pipelineRunId', () => {
    const PID = 'pipe-review-parent';
    const REVIEW_RUN = 'review-workflow-pipeline';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'review.completed', null, {
        payload: {
          pipelineRunId: PID,
          reviewWorkflowRunId: REVIEW_RUN,
          verdict: 'approved',
          confidence: 0.9,
        },
      }),
      makeEvent(5, 'state.transitioned', null, {
        payload: { pipelineRunId: PID, reviewWorkflowRunId: REVIEW_RUN, to: 'factory:approved' },
      }),
    ]);

    const reviewGroup = result.find((item) => item.kind === 'review-group');
    const phaseGroup = result.find((item) => item.kind === 'phase-group');

    expect(reviewGroup).toBeDefined();
    expect(phaseGroup).toBeDefined();
    if (reviewGroup?.kind === 'review-group') {
      const reviewEventKinds = reviewGroup.items.flatMap((item) =>
        item.kind === 'event' ? [item.event.kind] : [],
      );
      expect(reviewEventKinds).toEqual(['state.transitioned', 'review.completed']);
      expect(
        reviewGroup.items.some((item) => item.kind === 'run-group' && item.runId === PID),
      ).toBe(false);
    }
    if (phaseGroup?.kind === 'phase-group') {
      expect(
        phaseGroup.items.some(
          (item) =>
            item.kind === 'event' &&
            (item.event.kind === 'review.completed' || item.event.kind === 'state.transitioned'),
        ),
      ).toBe(false);
      expect(phaseGroup.items.some((item) => item.kind === 'run-group' && item.runId === PID)).toBe(
        true,
      );
    }
  });

  it('keeps multiple reviewWorkflowRunIds on one pipeline as separate review groups', () => {
    const PID = 'pipe-review-multi';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'review.completed', null, {
        payload: { pipelineRunId: PID, reviewWorkflowRunId: 'review-one', verdict: 'needs-fix' },
      }),
      makeEvent(5, 'review.completed', null, {
        payload: { pipelineRunId: PID, reviewWorkflowRunId: 'review-two', verdict: 'approved' },
      }),
    ]);

    const reviewGroups = result.filter((item) => item.kind === 'review-group');
    expect(reviewGroups).toHaveLength(2);
    expect(
      reviewGroups.map((item) =>
        item.kind === 'review-group' ? item.reviewWorkflowRunId : 'not-review',
      ),
    ).toEqual(expect.arrayContaining(['review-one', 'review-two']));
  });

  it('keeps child reviewer output inside the review parent group', () => {
    const REVIEW_RUN = 'review-workflow-output';
    const SLOT_RUN = 'review-slot-output';
    const result = groupEvents([
      makeEvent(1, 'agent.run-started', SLOT_RUN, {
        payload: { skill: 'review', reviewWorkflowRunId: REVIEW_RUN },
      }),
      makeEvent(2, 'review.slot-completed', SLOT_RUN, {
        payload: {
          reviewWorkflowRunId: REVIEW_RUN,
          round: 1,
          slotIndex: 0,
          verdict: 'needs-fix',
          confidence: 0.7,
          findingsCount: 1,
          criteriaChecks: [{ criterion: 'AC1', status: 'unmet' }],
        },
      }),
    ]);

    expect(result[0].kind).toBe('review-group');
    if (result[0].kind !== 'review-group') return;
    const childRun = result[0].items.find(
      (item) => item.kind === 'run-group' && item.runId === SLOT_RUN,
    ) as Extract<(typeof result)[0], { kind: 'review-group' }>['items'][number] | undefined;
    expect(childRun?.kind).toBe('run-group');
    if (childRun?.kind === 'run-group') {
      expect(
        childRun.items.some(
          (item) => item.kind === 'event' && item.event.kind === 'review.slot-completed',
        ),
      ).toBe(true);
    }
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
    'agent.output-repair-failed',
    'agent.retry-escalated',
    'symbol-index.hints-used',
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

describe('EVENT_KIND_LABEL — workflow routing kinds', () => {
  const KINDS = [
    'workflow.route-selected',
    'workflow.route-confirmed',
    'workflow.route-escalation-proposed',
    'workflow.route-cap-applied',
  ] as const;

  it.each(KINDS)('has a label for %s', (kind) => {
    expect(EVENT_KIND_LABEL[kind]).toBeDefined();
    expect(typeof EVENT_KIND_LABEL[kind]).toBe('string');
    expect(EVENT_KIND_LABEL[kind].length).toBeGreaterThan(0);
  });

  it('does not create live workflow-routing run groups for route events with reused run ids', () => {
    const items = groupTimelineEventsByCanonicalSection([
      makeEvent(1, 'agent.run-started', 'investigate-run', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(2, 'agent.run-completed', 'investigate-run', {
        payload: { skill: 'investigate' },
      }),
      makeEvent(3, 'workflow.route-confirmed', 'investigate-run', {
        payload: { tier: 'T2', source: 'investigation' },
      }),
      makeEvent(4, 'workflow.route-escalation-proposed', 'investigate-run', {
        payload: { requiredTier: 'T3', effectiveTier: 'T1' },
      }),
    ]);

    const delivery = items.find(
      (item): item is Extract<(typeof items)[number], { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'delivery-router',
    );
    const routeRun = delivery?.items.find(
      (item) => item.kind === 'run-group' && item.runId === 'investigate-run',
    );
    expect(routeRun).toBeUndefined();
    expect(delivery?.items.filter((item) => item.kind === 'event')).toHaveLength(2);

    const investigation = items.find(
      (item): item is Extract<(typeof items)[number], { kind: 'timeline-section' }> =>
        item.kind === 'timeline-section' && item.section === 'investigation',
    );
    const investigationRun = investigation?.items.find(
      (item) => item.kind === 'run-group' && item.runId === 'investigate-run',
    );
    expect(investigationRun).toMatchObject({
      kind: 'run-group',
      skill: 'investigate',
      endedAt: expect.any(String),
    });
  });
});
