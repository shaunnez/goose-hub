import type { AgentEvent } from '../../event-stream/store.js';
import { eventStore } from '../../event-stream/store.js';

const DISCOVER_SESSION_TERMINAL_EVENTS = new Set(['prd.drafted', 'prd.declined', 'prd.approved']);

type DiscoverSessionPayload = {
  discoverSessionId?: unknown;
};

function payloadDiscoverSessionId(event: AgentEvent): string | null {
  const payload = event.payload as DiscoverSessionPayload | null;
  return typeof payload?.discoverSessionId === 'string' && payload.discoverSessionId.trim() !== ''
    ? payload.discoverSessionId
    : null;
}

export function latestDiscoverSessionId(projectId: string, workItemId: string): string | null {
  const events = eventStore.replay({ projectId, workItemId });
  for (const event of [...events].reverse()) {
    const discoverSessionId = payloadDiscoverSessionId(event);
    if (discoverSessionId != null) return discoverSessionId;
  }
  return null;
}

export function activeDiscoverSessionId(projectId: string, workItemId: string): string | null {
  const events = eventStore.replay({ projectId, workItemId });
  let active: string | null = null;

  for (const event of events) {
    const discoverSessionId = payloadDiscoverSessionId(event);
    if (discoverSessionId != null) active = discoverSessionId;
    if (
      active != null &&
      discoverSessionId === active &&
      DISCOVER_SESSION_TERMINAL_EVENTS.has(event.kind)
    ) {
      active = null;
    }
  }

  return active;
}

export function resolveDiscoverSessionId(projectId: string, workItemId: string): string {
  return activeDiscoverSessionId(projectId, workItemId) ?? crypto.randomUUID();
}
