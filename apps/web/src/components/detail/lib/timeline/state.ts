import type { AgentEventDto } from '@/lib/types';

const TERMINAL_EVENTS = new Set([
  'agent.run-completed',
  'agent.run-failed',
  'grill.question-posted',
  'grill.completed',
  'decompose.completed',
  'retrospective.completed',
  'prd.drafted',
  'pr.opened',
  'parallel-implement.exhausted',
  'parallel-implement.wp-terminal-blocked',
  'qa.completed',
  'qa.verification-blocked',
]);

export type DecisionSummaryStatus = 'live' | 'completed';

function isGrillResumeTransition(event: AgentEventDto): boolean {
  if (event.kind !== 'state.transitioned') return false;

  const payload = (event.payload ?? {}) as {
    from?: string;
    fromState?: string;
    to?: string;
    toState?: string;
  };

  const from = payload.fromState ?? payload.from;
  const to = payload.toState ?? payload.to;

  return from === 'factory:gate-pending' && to === 'factory:grilling';
}

export function resolveDecisionSummaryStatus(
  event: AgentEventDto,
  events: readonly AgentEventDto[],
): DecisionSummaryStatus {
  if (event.kind !== 'agent.decision-summary-live') return 'completed';

  const laterEvents = [...events]
    .filter((candidate) => candidate.id > event.id)
    .sort((a, b) => a.id - b.id);

  for (const laterEvent of laterEvents) {
    if (laterEvent.kind === 'grill.question-posted' || laterEvent.kind === 'grill.completed') {
      return 'completed';
    }

    if (laterEvent.kind === 'agent.run-completed' && laterEvent.runId === event.runId) {
      return 'completed';
    }

    if (isGrillResumeTransition(laterEvent)) {
      return 'completed';
    }
  }

  return 'live';
}

export function computeIsLive(events: AgentEventDto[]): boolean {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let lastStartedIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].kind === 'agent.run-started') lastStartedIdx = i;
  }
  if (lastStartedIdx === -1) return false;
  for (let i = lastStartedIdx + 1; i < sorted.length; i++) {
    if (TERMINAL_EVENTS.has(sorted[i].kind)) return false;
  }
  return true;
}

export function computeIsWritePrdStuck(events: AgentEventDto[]): boolean {
  const hasWritePrdCompleted = events.some(
    (e) =>
      e.kind === 'agent.run-completed' &&
      (e.payload as { skill?: string } | null)?.skill === 'write-prd',
  );
  if (!hasWritePrdCompleted) return false;
  const hasPrdDrafted = events.some((e) => e.kind === 'prd.drafted');
  if (hasPrdDrafted) return false;
  return !computeIsLive(events);
}
