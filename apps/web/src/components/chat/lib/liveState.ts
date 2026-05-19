import type { ChatMessageDto, ChatToolInvocationDto } from '@/lib/types';
import type { ChatLiveEvent } from './useChatEvents';

/**
 * The orchestrator emits `chat.agent-thinking` at meaningful checkpoints
 * (at least `skill-invoked` and `structured-output-received`). The indicator
 * stays visible while an agent turn is in flight and clears the moment the
 * structured reply lands as `chat.agent-message`. We treat `chat.run-failed`
 * as a clear too — otherwise a stuck indicator would outlive a crashed run.
 */
export function deriveThinkingFromEvents(events: ChatLiveEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const kind = events[i].kind;
    if (kind === 'chat.agent-message' || kind === 'chat.run-failed') return false;
    if (kind === 'chat.agent-thinking') return true;
  }
  return false;
}

export function mergeMessagesFromEvents(
  base: ChatMessageDto[],
  events: ChatLiveEvent[],
  conversationId: string,
): ChatMessageDto[] {
  if (events.length === 0) return base;
  const byId = new Map(base.map((m) => [m.id, m]));
  let next = base;
  let changed = false;

  for (const ev of events) {
    if (ev.kind !== 'chat.user-message' && ev.kind !== 'chat.agent-message') continue;
    const payload = ev.payload as {
      conversationId?: unknown;
      messageId?: unknown;
      content?: unknown;
      runId?: unknown;
    };
    if (payload.conversationId !== conversationId) continue;
    if (typeof payload.messageId !== 'number' || typeof payload.content !== 'string') continue;
    if (byId.has(payload.messageId)) continue;

    const role = ev.kind === 'chat.user-message' ? 'user' : 'agent';
    const message: ChatMessageDto = {
      id: payload.messageId,
      conversationId,
      role,
      content: payload.content,
      runId: typeof payload.runId === 'string' ? payload.runId : null,
      meta: null,
      createdAt: ev.createdAt,
    };

    const optimisticIndex =
      role === 'user'
        ? next.findIndex((m) => m.id < 0 && m.role === 'user' && m.content === payload.content)
        : -1;
    if (optimisticIndex >= 0) {
      next = next.map((m, index) => (index === optimisticIndex ? message : m));
    } else {
      next = [...next, message];
    }
    byId.set(message.id, message);
    changed = true;
  }

  return changed ? next : base;
}

/**
 * Apply live tool-call status updates from the SSE stream onto a base set
 * of invocations. Returns a new array with `status`, `result`, `errorMessage`
 * patched for every invocation referenced by the events. Unknown invocation
 * ids are ignored — they belong to a sibling conversation, or to a new
 * proposal the base fetch hasn't seen yet (the next refresh will pick them
 * up).
 *
 * Terminal states are sticky: once an invocation reaches `completed` or
 * `failed`, no later event in either direction overwrites it. The SSE
 * stream is best-effort and can deliver out of order; we never want a
 * stale completion to clobber a real failure or vice versa.
 */
const TERMINAL_STATUSES: ReadonlySet<ChatToolInvocationDto['status']> = new Set([
  'completed',
  'failed',
]);

export function mergeToolStatusFromEvents(
  base: ChatToolInvocationDto[],
  events: ChatLiveEvent[],
): ChatToolInvocationDto[] {
  if (events.length === 0) return base;
  const byId = new Map(base.map((i) => [i.id, i]));
  let changed = false;
  let added = false;
  for (const ev of events) {
    const id = (ev.payload as { invocationId?: string }).invocationId;
    if (id == null) continue;
    const existing = byId.get(id);
    if (existing == null && ev.kind === 'chat.tool-proposed') {
      const payload = ev.payload as {
        conversationId?: string;
        toolName?: string;
        mutating?: boolean;
        rationale?: string;
      };
      if (payload.conversationId == null || payload.toolName == null) continue;
      byId.set(id, {
        id,
        conversationId: payload.conversationId,
        messageId: null,
        toolName: payload.toolName,
        input: typeof payload.rationale === 'string' ? { _rationale: payload.rationale } : {},
        mutating: payload.mutating === true,
        status: payload.mutating === true ? 'proposed' : 'running',
        result: null,
        errorMessage: null,
        runId: null,
        createdAt: ev.createdAt,
        updatedAt: ev.createdAt,
      });
      changed = true;
      added = true;
      continue;
    }
    if (existing == null) continue;
    // Sticky terminal: nothing overwrites `completed`/`failed`.
    if (TERMINAL_STATUSES.has(existing.status)) continue;
    let next: ChatToolInvocationDto | null = null;
    if (ev.kind === 'chat.tool-running') {
      next = { ...existing, status: 'running' };
    } else if (ev.kind === 'chat.tool-completed') {
      next = {
        ...existing,
        status: 'completed',
        result: (ev.payload as { result?: unknown }).result ?? existing.result,
      };
    } else if (ev.kind === 'chat.tool-failed') {
      const error = (ev.payload as { error?: string }).error;
      next = {
        ...existing,
        status: 'failed',
        errorMessage: typeof error === 'string' ? error : existing.errorMessage,
      };
    } else if (ev.kind === 'chat.tool-approved' && existing.status === 'proposed') {
      // Multi-tab: another client resolved the proposal. Flip locally so the
      // Approve/Reject buttons disappear instead of waiting for refresh.
      next = { ...existing, status: 'approved' };
    } else if (ev.kind === 'chat.tool-rejected' && existing.status === 'proposed') {
      next = { ...existing, status: 'rejected' };
    }
    if (next != null) {
      byId.set(id, next);
      changed = true;
    }
  }
  if (!changed) return base;
  if (added) return Array.from(byId.values());
  return base.map((i) => byId.get(i.id) ?? i);
}
