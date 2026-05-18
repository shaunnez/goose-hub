import { useEffect, useState } from 'react';

export interface ChatLiveEvent {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Subscribe to the SSE event stream and surface only chat.* events tagged for
 * the given conversationId. Used to render live tool-call progression in the
 * chat panel between the user message and the agent's structured reply.
 */
export function useChatEvents(conversationId: string | null): ChatLiveEvent[] {
  const [events, setEvents] = useState<ChatLiveEvent[]>([]);

  useEffect(() => {
    if (conversationId == null) {
      setEvents([]);
      return;
    }
    setEvents([]);
    const source = new EventSource('/events');
    const handler = (ev: MessageEvent) => {
      let parsed: { id: number; kind: string; payload: Record<string, unknown>; createdAt: string };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!parsed.kind?.startsWith('chat.')) return;
      const pcid = (parsed.payload as { conversationId?: string })?.conversationId;
      if (pcid !== conversationId) return;
      setEvents((prev) => [...prev, parsed]);
    };
    source.onmessage = handler;
    // SSE in this app dispatches one named event per event.kind too; subscribe
    // to a couple of kinds explicitly so they don't get dropped if a browser
    // refuses to fall through.
    const kindsToSubscribe = [
      'chat.user-message',
      'chat.agent-message',
      'chat.agent-thinking',
      'chat.tool-proposed',
      'chat.tool-approved',
      'chat.tool-rejected',
      'chat.tool-running',
      'chat.tool-completed',
      'chat.tool-failed',
      'chat.run-failed',
    ];
    for (const kind of kindsToSubscribe) source.addEventListener(kind, handler);
    return () => {
      for (const kind of kindsToSubscribe) source.removeEventListener(kind, handler);
      source.close();
    };
  }, [conversationId]);

  return events;
}
