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
  'qa.workflow-completed',
  'qa.workflow-failed',
  'qa.workflow-aborted',
]);

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
