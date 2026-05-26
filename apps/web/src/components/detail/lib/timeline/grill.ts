import type { AgentEventDto } from '@/lib/types';

export function isAnsweredGrillTransition(event: AgentEventDto): boolean {
  if (event.kind !== 'state.transitioned') return false;

  const payload = event.payload as {
    discoverSessionId?: unknown;
    from?: unknown;
    skill?: unknown;
    to?: unknown;
    workflowSkill?: unknown;
  } | null;

  if (payload?.from !== 'factory:gate-pending' || payload.to !== 'factory:grilling') return false;
  if (typeof payload.discoverSessionId === 'string' && payload.discoverSessionId.trim() !== '') {
    return true;
  }
  if (payload?.skill === 'grill-me' || payload?.workflowSkill === 'grill-me') return true;
  return event.runId?.endsWith(':grill-me') ?? false;
}
