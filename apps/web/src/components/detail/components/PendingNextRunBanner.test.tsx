import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { computeIsLive } from './PendingNextRunBanner';

function makeEvent(kind: string, id: number): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'item',
    kind,
    payload: {},
    runId: 'run-1',
    personaId: null,
    createdAt: new Date(id * 1000).toISOString(),
  };
}

describe('computeIsLive', () => {
  it('returns false when no events', () => {
    expect(computeIsLive([])).toBe(false);
  });

  it('returns false when no agent.run-started event', () => {
    expect(computeIsLive([makeEvent('state.transitioned', 1)])).toBe(false);
  });

  it('returns true when run-started with no terminal event after', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.spawned', 2)];
    expect(computeIsLive(events)).toBe(true);
  });

  it('returns false when run-started followed by agent.run-completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.run-completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by agent.run-failed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.run-failed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by grill.question-posted', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('grill.question-posted', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by grill.completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('grill.completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by decompose.completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('decompose.completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by retrospective.completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('retrospective.completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by prd.drafted', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('prd.drafted', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns true when second run started after first completed', () => {
    const events = [
      makeEvent('agent.run-started', 1),
      makeEvent('agent.run-completed', 2),
      makeEvent('agent.run-started', 3),
    ];
    expect(computeIsLive(events)).toBe(true);
  });

  it('handles descending order (as returned by server API)', () => {
    // Server returns events newest-first; completed run should not appear live
    const events = [
      makeEvent('agent.run-completed', 3),
      makeEvent('agent.run-started', 2),
      makeEvent('state.transitioned', 1),
    ];
    expect(computeIsLive(events)).toBe(false);
  });
});
