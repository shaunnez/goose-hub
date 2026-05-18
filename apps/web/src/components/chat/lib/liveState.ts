import type { ChatToolInvocationDto } from '@/lib/types';
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
  for (const ev of events) {
    const id = (ev.payload as { invocationId?: string }).invocationId;
    if (id == null) continue;
    const existing = byId.get(id);
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
  return changed ? base.map((i) => byId.get(i.id) ?? i) : base;
}
