import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { groupEvents } from '../lib/timeline';

function makeLogEvent(id: number): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind: 'agent.log',
    payload: { line: `log line ${id}` },
    createdAt: new Date().toISOString(),
  };
}

function makeEvent(id: number, kind: string): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind,
    payload: {},
    createdAt: new Date().toISOString(),
  };
}

describe('groupEvents — agent.log collapsing', () => {
  it('groups 5 consecutive agent.log events into one log-group', () => {
    const logs = [1, 2, 3, 4, 5].map(makeLogEvent);
    const result = groupEvents(logs);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('log-group');
    if (result[0].kind === 'log-group') {
      expect(result[0].events).toHaveLength(5);
    }
  });

  it('keeps 3 consecutive agent.log events as individual items', () => {
    const logs = [1, 2, 3].map(makeLogEvent);
    const result = groupEvents(logs);
    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(item.kind).toBe('event');
      if (item.kind === 'event') {
        expect(item.event.kind).toBe('agent.log');
      }
    }
  });

  it('keeps exactly 4 consecutive agent.log events as a group', () => {
    const logs = [1, 2, 3, 4].map(makeLogEvent);
    const result = groupEvents(logs);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('log-group');
  });

  it('groups only the consecutive log run, leaves other events in place', () => {
    const events: AgentEventDto[] = [
      makeEvent(10, 'agent.spawned'),
      makeLogEvent(11),
      makeLogEvent(12),
      makeLogEvent(13),
      makeLogEvent(14),
      makeLogEvent(15),
      makeEvent(20, 'agent.terminated'),
    ];
    const result = groupEvents(events);
    // spawned + log-group + terminated
    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe('event');
    expect(result[1].kind).toBe('log-group');
    expect(result[2].kind).toBe('event');
    if (result[1].kind === 'log-group') {
      expect(result[1].events).toHaveLength(5);
    }
  });

  it('two separate runs of 2 logs each stay as individual items', () => {
    const events: AgentEventDto[] = [
      makeLogEvent(1),
      makeLogEvent(2),
      makeEvent(3, 'system.note'),
      makeLogEvent(4),
      makeLogEvent(5),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(5);
    for (const item of result) {
      expect(item.kind).not.toBe('log-group');
    }
  });
});

// ─── M4: run-group grouping by runId ─────────────────────────────────────────

function makeRunEvent(
  id: number,
  runId: string,
  kind = 'agent.run-started',
  skill?: string,
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind,
    payload: skill != null ? { skill } : {},
    runId,
    createdAt: new Date(Date.now() + id * 1000).toISOString(),
  };
}

describe('groupEvents — run-group by runId', () => {
  it('groups 2+ consecutive events with same runId into a run-group', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started'),
      makeRunEvent(2, 'run-abc', 'agent.tool-call'),
      makeRunEvent(3, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('run-group');
    if (result[0].kind === 'run-group') {
      expect(result[0].runId).toBe('run-abc');
      expect(result[0].items).toHaveLength(3);
    }
  });

  it('single event with runId stays as individual event (not grouped)', () => {
    const events: AgentEventDto[] = [makeRunEvent(1, 'run-solo', 'agent.run-started')];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('event');
  });

  it('events without runId are not grouped', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'system.note'),
      makeEvent(2, 'state.transitioned'),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(item.kind).toBe('event');
    }
  });

  it('interleaved runs produce separate run-groups', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-a', 'agent.run-started'),
      makeRunEvent(2, 'run-a', 'agent.run-completed'),
      makeRunEvent(3, 'run-b', 'agent.run-started'),
      makeRunEvent(4, 'run-b', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('run-group');
    expect(result[1].kind).toBe('run-group');
    if (result[0].kind === 'run-group') expect(result[0].runId).toBe('run-b');
    if (result[1].kind === 'run-group') expect(result[1].runId).toBe('run-a');
  });

  it('decision-summary event renders with kind label and summary text', () => {
    const events: AgentEventDto[] = [
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'wi-1',
        kind: 'agent.decision-summary',
        payload: { kind: 'INSIGHT', summary: 'Chose approach A over B' },
        createdAt: new Date().toISOString(),
      },
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('event');
    if (result[0].kind === 'event') {
      expect(result[0].event.kind).toBe('agent.decision-summary');
      const p = result[0].event.payload as { kind: string; summary: string };
      expect(p.kind).toBe('INSIGHT');
      expect(p.summary).toBe('Chose approach A over B');
    }
  });

  it('tool-call event remains a single event (not log-group)', () => {
    const events: AgentEventDto[] = [makeRunEvent(1, 'run-x', 'agent.tool-call')];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('event');
    if (result[0].kind === 'event') {
      expect(result[0].event.kind).toBe('agent.tool-call');
    }
  });

  it('keeps live decision summaries inside the same run group as tool calls', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-live', 'agent.run-started', 'implement'),
      makeRunEvent(2, 'run-live', 'agent.tool-call'),
      {
        ...makeRunEvent(3, 'run-live', 'agent.decision-summary-live'),
        payload: { kind: 'READ', summary: 'Searching app shell components', skill: 'implement' },
      },
      makeRunEvent(4, 'run-live', 'agent.tool-call'),
    ];

    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('run-group');
    if (result[0].kind === 'run-group') {
      expect(result[0].runId).toBe('run-live');
      expect(
        result[0].items.map((item) => (item.kind === 'event' ? item.event.kind : item.kind)),
      ).toEqual([
        'agent.run-started',
        'agent.tool-call',
        'agent.decision-summary-live',
        'agent.tool-call',
      ]);
    }
  });
});

// ─── run-group metadata ───────────────────────────────────────────────────────

describe('groupEvents — run-group metadata', () => {
  it('extracts skill from agent.run-started payload', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started', 'implement'),
      makeRunEvent(2, 'run-abc', 'agent.tool-call'),
      makeRunEvent(3, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    if (result[0].kind === 'run-group') {
      expect(result[0].skill).toBe('implement');
      expect(result[0].startedAt).toBe(events[0].createdAt);
      expect(result[0].endedAt).toBe(events[2].createdAt);
    }
  });

  it('extracts model and runtime from agent.run-started payload before cost rows exist', () => {
    const events: AgentEventDto[] = [
      {
        ...makeRunEvent(1, 'run-abc', 'agent.run-started', 'implement'),
        payload: {
          skill: 'implement',
          modelId: 'gpt-5.4',
          runtime: 'codex-cli',
        },
      },
      makeRunEvent(2, 'run-abc', 'agent.tool-call'),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    if (result[0].kind === 'run-group') {
      expect(result[0].modelId).toBe('gpt-5.4');
      expect(result[0].runtime).toBe('codex-cli');
      expect(result[0].startedAt).toBe(events[0].createdAt);
      expect(result[0].endedAt).toBeNull();
    }
  });

  it('falls back to agent.spawned skill when run-started has no skill', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started'),
      { ...makeRunEvent(2, 'run-abc', 'agent.spawned'), payload: { skill: 'triage' } },
      makeRunEvent(3, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].skill).toBe('triage');
    }
  });

  it('sets skill to null when no skill found in any event', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started'),
      makeRunEvent(2, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].skill).toBeNull();
    }
  });

  it('sets endedAt to null when run has no completed/failed event', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started', 'implement'),
      makeRunEvent(2, 'run-abc', 'agent.tool-call'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].endedAt).toBeNull();
    }
  });

  it('uses earliest event timestamp as startedAt fallback when no run-started event', () => {
    const t1 = new Date(Date.now()).toISOString();
    const t2 = new Date(Date.now() + 2000).toISOString();
    const events: AgentEventDto[] = [
      { ...makeRunEvent(1, 'run-abc', 'agent.tool-call'), createdAt: t1 },
      { ...makeRunEvent(2, 'run-abc', 'agent.run-completed'), createdAt: t2 },
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].startedAt).toBe(t1);
    }
  });

  it('extracts endedAt from agent.run-failed', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started', 'qa'),
      makeRunEvent(2, 'run-abc', 'agent.run-failed'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].endedAt).toBe(events[1].createdAt);
    }
  });

  it('resolves skill from any event payload, not just lifecycle events', () => {
    const events: AgentEventDto[] = [
      { ...makeRunEvent(1, 'run-abc', 'agent.tool-call'), payload: { skill: 'implement' } },
      makeRunEvent(2, 'run-abc', 'agent.run-started'),
      makeRunEvent(3, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    if (result[0].kind === 'run-group') {
      expect(result[0].skill).toBe('implement');
    }
  });
});
