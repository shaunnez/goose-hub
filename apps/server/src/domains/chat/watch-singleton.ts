import { appendMessage, getConversation } from '@goose-hub/core/conversations/repository.js';
import type { ChatMessage } from '@goose-hub/core/conversations/types.js';
import { type AgentEvent, eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { type Watch, WatchRegistry } from './watches.js';

function buildSummary(watch: Watch, event: AgentEvent): string {
  if (watch.kind === 'run') {
    const { runId } = watch.params as { runId: string };
    const payload = (event.payload as Record<string, unknown>) ?? {};
    if (event.kind === 'agent.run-failed') {
      const error = typeof payload.error === 'string' ? payload.error : 'unknown error';
      return `Watched run \`${runId}\` failed: ${error}`;
    }
    const cost = typeof payload.costUsd === 'number' ? payload.costUsd : null;
    const decisions = Array.isArray(payload.decisionSummaries)
      ? payload.decisionSummaries.length
      : 0;
    const parts: string[] = [`Watched run \`${runId}\` completed.`];
    if (cost != null) parts.push(`Cost: $${cost.toFixed(4)}`);
    parts.push(`${decisions} decision${decisions === 1 ? '' : 's'} emitted.`);
    return parts.join(' ');
  }
  const { workItemId } = watch.params as { workItemId: string };
  const payload = (event.payload as Record<string, unknown>) ?? {};
  const from = typeof payload.from === 'string' ? payload.from : null;
  const to = typeof payload.to === 'string' ? payload.to : null;
  const itemLabel = workItemId.includes('#') ? `#${workItemId.split('#').pop()}` : workItemId;
  if (from != null && to != null) {
    return `Watched issue ${itemLabel} moved from \`${from}\` to \`${to}\`.`;
  }
  return `Watched issue ${itemLabel} transitioned.`;
}

function fireSubscriptionFollowUp({ watch, event }: { watch: Watch; event: AgentEvent }): void {
  const conversation = getConversation(watch.conversationId);
  if (conversation == null) return;

  const summary = buildSummary(watch, event);
  let message: ChatMessage;
  try {
    message = appendMessage({
      conversationId: conversation.id,
      role: 'agent',
      content: summary,
      meta: {
        kind: 'subscription-fired',
        watchId: watch.id,
        watchKind: watch.kind,
        watchParams: watch.params,
        sourceEvent: { id: event.id, kind: event.kind, createdAt: event.createdAt },
      },
    });
  } catch (err) {
    logger.warn('chat-watches.appendMessage failed', { err: String(err), watchId: watch.id });
    return;
  }

  eventStore.appendEvent({
    projectId: conversation.projectId ?? 'goose-hub-self',
    workItemId: null,
    kind: 'chat.agent-message',
    payload: {
      conversationId: conversation.id,
      messageId: message.id,
      runId: null,
      content: summary,
      subscriptionFired: {
        watchId: watch.id,
        watchKind: watch.kind,
        sourceEventId: event.id,
      },
    },
  });
}

let singleton: WatchRegistry | null = null;

/**
 * Lazily-constructed shared registry. First reference subscribes to the event
 * store; subsequent references reuse the same instance.
 */
export function getWatchRegistry(): WatchRegistry {
  if (singleton == null) {
    singleton = new WatchRegistry(fireSubscriptionFollowUp);
    singleton.start();
  }
  return singleton;
}

/** Test-only: reset the lazy singleton so tests can swap behaviour. */
export function __resetWatchRegistryForTests(replacement: WatchRegistry | null = null): void {
  if (singleton != null) singleton.stop();
  singleton = replacement;
}
