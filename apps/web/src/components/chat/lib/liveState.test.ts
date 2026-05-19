import type { ChatMessageDto, ChatToolInvocationDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import {
  deriveThinkingFromEvents,
  mergeMessagesFromEvents,
  mergeToolStatusFromEvents,
} from './liveState';
import type { ChatLiveEvent } from './useChatEvents';

function event(id: number, kind: string, payload: Record<string, unknown> = {}): ChatLiveEvent {
  return { id, kind, payload, createdAt: '2026-05-18T00:00:00Z' };
}

function message(id: number, role: ChatMessageDto['role'], content: string): ChatMessageDto {
  return {
    id,
    conversationId: 'conv_x',
    role,
    content,
    runId: null,
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
  };
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
    runId: null,
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

describe('mergeMessagesFromEvents', () => {
  it('appends agent messages from the event stream', () => {
    const merged = mergeMessagesFromEvents(
      [message(1, 'user', 'hello')],
      [
        event(2, 'chat.agent-message', {
          conversationId: 'conv_x',
          messageId: 2,
          content: 'hi',
          runId: 'chat_run',
        }),
      ],
      'conv_x',
    );
    expect(merged.map((m) => m.content)).toEqual(['hello', 'hi']);
    expect(merged[1].runId).toBe('chat_run');
  });

  it('replaces a matching optimistic user message', () => {
    const merged = mergeMessagesFromEvents(
      [message(-1, 'user', 'hello')],
      [
        event(1, 'chat.user-message', {
          conversationId: 'conv_x',
          messageId: 1,
          content: 'hello',
          runId: 'chat_run',
        }),
      ],
      'conv_x',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(1);
  });

  it('ignores stale message events from the previously selected conversation', () => {
    const merged = mergeMessagesFromEvents(
      [],
      [
        event(1, 'chat.user-message', {
          conversationId: 'conv_old',
          messageId: 1,
          content: 'old thread message',
          runId: 'chat_run_old',
        }),
      ],
      'conv_new',
    );

    expect(merged).toEqual([]);
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

  it('adds proposed invocations from chat.tool-proposed', () => {
    const merged = mergeToolStatusFromEvents(
      [],
      [
        event(1, 'chat.tool-proposed', {
          conversationId: 'conv_x',
          invocationId: 'tool_a',
          toolName: 'find_pr',
          mutating: false,
          rationale: 'find it',
        }),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: 'tool_a',
        toolName: 'find_pr',
        status: 'running',
      }),
    );
  });

  it('can build a completed read-only tool card from SSE events only', () => {
    const merged = mergeToolStatusFromEvents(
      [],
      [
        event(1, 'chat.tool-proposed', {
          conversationId: 'conv_x',
          invocationId: 'tool_a',
          toolName: 'recent_events',
          mutating: false,
          rationale: 'check status',
        }),
        event(2, 'chat.tool-running', { invocationId: 'tool_a' }),
        event(3, 'chat.tool-completed', {
          invocationId: 'tool_a',
          result: { events: [{ kind: 'agent.run-completed' }] },
        }),
      ],
    );

    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: 'tool_a',
        toolName: 'recent_events',
        status: 'completed',
        result: { events: [{ kind: 'agent.run-completed' }] },
      }),
    );
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

  it('does not flip completed to failed when a stale chat.tool-failed arrives', () => {
    const base = [invocation('tool_a', 'completed')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-failed', { invocationId: 'tool_a', error: 'stale' }),
    ]);
    expect(merged[0].status).toBe('completed');
    expect(merged[0].errorMessage).toBeNull();
  });

  it('does not flip failed to completed when a stale chat.tool-completed arrives', () => {
    const base = [invocation('tool_a', 'failed')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-completed', { invocationId: 'tool_a', result: { stale: true } }),
    ]);
    expect(merged[0].status).toBe('failed');
    expect(merged[0].result).toBeNull();
  });

  it('flips a proposed invocation to approved on chat.tool-approved', () => {
    const base = [invocation('tool_a', 'proposed')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-approved', { invocationId: 'tool_a' }),
    ]);
    expect(merged[0].status).toBe('approved');
  });

  it('flips a proposed invocation to rejected on chat.tool-rejected', () => {
    const base = [invocation('tool_a', 'proposed')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-rejected', { invocationId: 'tool_a' }),
    ]);
    expect(merged[0].status).toBe('rejected');
  });

  it('ignores chat.tool-approved when the invocation is no longer proposed', () => {
    const base = [invocation('tool_a', 'running')];
    const merged = mergeToolStatusFromEvents(base, [
      event(1, 'chat.tool-approved', { invocationId: 'tool_a' }),
    ]);
    expect(merged[0].status).toBe('running');
  });
});
