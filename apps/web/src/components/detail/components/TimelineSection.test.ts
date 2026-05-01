import { describe, expect, it } from 'vitest';
import type { AgentEventDto } from '../../../lib/types';
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
