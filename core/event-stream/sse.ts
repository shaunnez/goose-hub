import { type AgentEvent, eventStore } from './store.js';

export interface SseFilter {
  projectId?: string;
  workItemId?: string;
}

/**
 * Streaming SSE body. Replays events with id > lastEventId (filtered), then
 * tails new events live until the underlying stream is cancelled.
 */
export function buildSseStream(
  filter: SseFilter,
  lastEventId: number | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  // Hoisted so both start() and cancel() share the same reference.
  let cleanup: (() => void) | null = null;

  return new ReadableStream({
    start(controller) {
      const send = (event: AgentEvent) => {
        if (filter.projectId != null && event.projectId !== filter.projectId) return;
        if (filter.workItemId != null && event.workItemId !== filter.workItemId) return;
        try {
          const payload = JSON.stringify(event);
          controller.enqueue(
            encoder.encode(`id: ${event.id}\nevent: ${event.kind}\ndata: ${payload}\n\n`),
          );
        } catch {
          // Controller closed before cancel() fired — clean up now.
          cleanup?.();
          cleanup = null;
        }
      };

      // 1. Replay durable events past the last seen id.
      const replay = eventStore.replay({ ...filter, sinceId: lastEventId });
      for (const event of replay) send(event);

      // 2. Heartbeat to keep proxies / browsers from killing the connection.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // 3. Tail live events.
      const unsubscribe = eventStore.subscribe(send);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },

    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });
}
