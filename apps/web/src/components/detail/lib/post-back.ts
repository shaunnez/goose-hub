import type { AgentEventDto } from '@/lib/types';

export function latestInvestigationText(events: AgentEventDto[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind !== 'agent.investigation-complete') continue;
    const payload = event.payload;
    if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const investigate = (payload as { investigate?: unknown }).investigate;
    if (investigate == null || typeof investigate !== 'object' || Array.isArray(investigate)) {
      continue;
    }
    const findings = (investigate as { findings?: unknown }).findings;
    if (typeof findings !== 'string') continue;
    const trimmed = findings.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}
