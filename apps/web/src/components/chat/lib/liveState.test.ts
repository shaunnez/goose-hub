import type { ChatToolInvocationDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { deriveThinkingFromEvents, mergeToolStatusFromEvents } from './liveState';
import type { ChatLiveEvent } from './useChatEvents';

function event(id: number, kind: string, payload: Record<string, unknown> = {}): ChatLiveEvent {
  return { id, kind, payload, createdAt: '2026-05-18T00:00:00Z' };
}

function invocation(id: string, status: ChatToolInvocationDto['status']): ChatToolInvocationDto {
  return {
    id,
    conversationId: 'conv_x',
    messageId: 1,
    toolName: 'list_projects',
    input: {},
    mutating: false,
    status,
    result: null,
    errorMessage: null,
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
  };
}

describe('deriveThinkingFromEvents', () => {
  it('is false on an empty stream', () => {
    expect(deriveThinkingFromEvents([])).toBe(false);
  });

  it('is true once a thinking event has arrived with no later agent-message', () => {
    expect(
      deriveThinkingFromEvents([
        event(1, 'chat.user-message'),
        event(2, 'chat.agent-thinking', { checkpoint: 'skill-invoked' }),
      ]),
    ).toBe(true);
  });

  it('clears the moment chat.agent-message arrives', () => {
    expect(
      deriveThinkingFromEvents([
        event(1, 'chat.agent-thinking', { checkpoint: 'skill-invoked' }),
        event(2, 'chat.agent-thinking', { checkpoint: 'structured-output-received' }),
        event(3, 'chat.agent-message'),
      ]),
    ).toBe(false);
  });

  it('clears when the run fails', () => {
    expect(
      deriveThinkingFromEvents([
        event(1, 'chat.agent-thinking', { checkpoint: 'skill-invoked' }),
        event(2, 'chat.run-failed'),
      ]),
    ).toBe(false);
  });

  it('reactivates if a new turn starts after a previous reply', () => {
    expect(
      deriveThinkingFromEvents([
        event(1, 'chat.agent-thinking'),
        event(2, 'chat.agent-message'),
        event(3, 'chat.user-message'),
        event(4, 'chat.agent-thinking'),
      ]),
    ).toBe(true);
  });
});

describe('mergeToolStatusFromEvents', () => {
  it('returns the base unchanged when there are no events', () => {
    const base = [invocation('tool_a', 'proposed')];
    expect(mergeToolStatusFromEvents(base, [])).toBe(base);
  });

  it('flips a known invocation to running on chat.tool-running', () => {
    const base = [invocation('tool_a', 'approved')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-running', { invocationId: 'tool_a' }),
    ]);
    expect(merged[0].status).toBe('running');
  });

  it('flips a known invocation to completed and merges the result', () => {
    const base = [invocation('tool_a', 'running')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-completed', { invocationId: 'tool_a', result: { ok: true } }),
    ]);
    expect(merged[0].status).toBe('completed');
    expect(merged[0].result).toEqual({ ok: true });
  });

  it('flips a known invocation to failed and stores the error message', () => {
    const base = [invocation('tool_a', 'running')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-failed', { invocationId: 'tool_a', error: 'kaboom' }),
    ]);
    expect(merged[0].status).toBe('failed');
    expect(merged[0].errorMessage).toBe('kaboom');
  });

  it('ignores tool events whose invocationId is not in the base list', () => {
    const base = [invocation('tool_a', 'completed')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-running', { invocationId: 'tool_unknown' }),
    ]);
    expect(merged).toBe(base);
  });

  it('does not regress a terminal status back to running', () => {
    const base = [invocation('tool_a', 'completed')];
    // A late chat.tool-running for an already-completed invocation must not
    // flip the badge back; the SSE stream is best-effort and may arrive out
    // of order.
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-running', { invocationId: 'tool_a' }),
    ]);
    expect(merged[0].status).toBe('completed');
  });
});
