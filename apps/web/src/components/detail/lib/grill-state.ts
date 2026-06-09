import type { AgentEventDto } from '@/lib/types';
import { computeIsLive } from './timeline/state';

export interface GrillLifecycleSnapshot {
  phase: 'loading' | 'awaiting-reply' | 'in-progress' | 'complete';
  effectiveState: string | undefined;
  isLive: boolean;
  isComplete: boolean;
  hasLatestUnansweredQuestion: boolean;
  terminalEventKind: 'grill.completed' | 'prd.drafted' | null;
}

export function deriveGrillLifecycleSnapshot(args: {
  itemState: string | undefined;
  events: AgentEventDto[];
  hasLatestUnansweredQuestion: boolean;
  isCommentsLoading: boolean;
}): GrillLifecycleSnapshot {
  const { itemState, events, hasLatestUnansweredQuestion, isCommentsLoading } = args;
  const terminalEventKind =
    [...events]
      .sort((a, b) => a.id - b.id)
      .findLast(
        (event): event is AgentEventDto & { kind: 'grill.completed' | 'prd.drafted' } =>
          event.kind === 'grill.completed' || event.kind === 'prd.drafted',
      )?.kind ?? null;

  const effectiveState =
    terminalEventKind == null && itemState === 'factory:grilling' && hasLatestUnansweredQuestion
      ? 'factory:gate-pending'
      : itemState;

  const isComplete =
    terminalEventKind != null ||
    effectiveState === 'factory:prd-drafting' ||
    effectiveState === 'factory:prd-review' ||
    effectiveState === 'factory:decomposing' ||
    effectiveState === 'factory:issues-created' ||
    effectiveState === 'factory:done';

  const isLive = terminalEventKind == null && computeIsLive(events);

  if (isComplete) {
    return {
      phase: 'complete',
      effectiveState,
      isLive: false,
      isComplete: true,
      hasLatestUnansweredQuestion,
      terminalEventKind,
    };
  }

  if (isCommentsLoading) {
    return {
      phase: 'loading',
      effectiveState,
      isLive,
      isComplete: false,
      hasLatestUnansweredQuestion,
      terminalEventKind: null,
    };
  }

  if (effectiveState === 'factory:gate-pending') {
    return {
      phase: 'awaiting-reply',
      effectiveState,
      isLive,
      isComplete: false,
      hasLatestUnansweredQuestion,
      terminalEventKind: null,
    };
  }

  return {
    phase: 'in-progress',
    effectiveState,
    isLive,
    isComplete: false,
    hasLatestUnansweredQuestion,
    terminalEventKind: null,
  };
}
