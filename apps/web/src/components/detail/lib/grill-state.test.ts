import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { deriveGrillLifecycleSnapshot } from './grill-state';

function event(kind: string, id: number): AgentEventDto {
  return {
    id,
    kind,
    projectId: 'proj',
    workItemId: '42',
    payload: null,
    createdAt: '2026-06-09T00:00:00Z',
  };
}

describe('deriveGrillLifecycleSnapshot', () => {
  it('treats grill.completed as authoritative completion while comments are loading', () => {
    const snapshot = deriveGrillLifecycleSnapshot({
      itemState: 'factory:grilling',
      events: [event('agent.run-started', 1), event('grill.completed', 2)],
      hasLatestUnansweredQuestion: false,
      isCommentsLoading: true,
    });

    expect(snapshot).toMatchObject({
      phase: 'complete',
      effectiveState: 'factory:grilling',
      isLive: false,
      isComplete: true,
      hasLatestUnansweredQuestion: false,
      terminalEventKind: 'grill.completed',
    });
  });

  it('treats prd.drafted as authoritative completion even with stale grilling state', () => {
    const snapshot = deriveGrillLifecycleSnapshot({
      itemState: 'factory:grilling',
      events: [event('agent.run-started', 1), event('prd.drafted', 2)],
      hasLatestUnansweredQuestion: true,
      isCommentsLoading: true,
    });

    expect(snapshot).toMatchObject({
      phase: 'complete',
      effectiveState: 'factory:grilling',
      isLive: false,
      isComplete: true,
      hasLatestUnansweredQuestion: true,
      terminalEventKind: 'prd.drafted',
    });
  });

  it('preserves stale grilling to gate-pending normalization for unanswered questions', () => {
    const snapshot = deriveGrillLifecycleSnapshot({
      itemState: 'factory:grilling',
      events: [event('agent.run-started', 1)],
      hasLatestUnansweredQuestion: true,
      isCommentsLoading: false,
    });

    expect(snapshot).toMatchObject({
      phase: 'awaiting-reply',
      effectiveState: 'factory:gate-pending',
      isLive: true,
      isComplete: false,
      hasLatestUnansweredQuestion: true,
      terminalEventKind: null,
    });
  });

  it('keeps loading phase only while the session is still non-terminal', () => {
    const snapshot = deriveGrillLifecycleSnapshot({
      itemState: 'factory:grilling',
      events: [event('agent.run-started', 1)],
      hasLatestUnansweredQuestion: false,
      isCommentsLoading: true,
    });

    expect(snapshot).toMatchObject({
      phase: 'loading',
      effectiveState: 'factory:grilling',
      isLive: true,
      isComplete: false,
      hasLatestUnansweredQuestion: false,
      terminalEventKind: null,
    });
  });
});
