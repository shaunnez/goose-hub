import { describe, expect, it, vi } from 'vitest';

// Skill invocation is mocked at the agent-runtime layer because spawning a
// real subprocess in tests is out of scope for the slice contract.
vi.mock('@goose-hub/core/agent-runtime/invoke-skill.js', () => ({
  invokeSkill: vi.fn(),
}));

// The event store is heavyweight; we only need replay() to return [].
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    replay: vi.fn(() => []),
    appendEvent: vi.fn(),
  },
}));

import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import type { Conversation } from '@goose-hub/core/conversations/types.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { runChatOrchestratorTurn } from './workflow.js';

const stubConversation: Conversation = {
  id: 'conv_test',
  scope: 'global',
  projectId: null,
  workItemId: null,
  title: '',
  runtime: 'claude',
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
};

describe('chat-orchestrator slice', () => {
  it('returns a parsed reply when the skill output validates', async () => {
    vi.mocked(invokeSkill).mockResolvedValueOnce({
      output: {
        say: 'Hello there.',
        proposals: [],
        done: false,
        decisionSummaries: [{ kind: 'PLAN', summary: 'Replied to greeting.' }],
      },
      decisionSummaries: [],
      events: [],
    });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [
        {
          id: 1,
          conversationId: 'conv_test',
          role: 'user',
          content: 'hi',
          runId: null,
          meta: null,
          createdAt: '2026-05-18T00:00:00Z',
        },
      ],
      runId: 'chat_test_run',
    });
    expect(result.reply).not.toBeNull();
    expect(result.reply?.say).toBe('Hello there.');
  });

  it('drops proposals for unknown tool names', async () => {
    vi.mocked(invokeSkill).mockResolvedValueOnce({
      output: {
        say: 'Doing things.',
        proposals: [
          { toolName: 'list_projects', input: {}, rationale: 'see all projects' },
          { toolName: 'i_made_this_up', input: {}, rationale: 'nope' },
        ],
        done: false,
        decisionSummaries: [{ kind: 'PLAN', summary: 'Proposing two tools.' }],
      },
      decisionSummaries: [],
      events: [],
    });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_2',
    });
    expect(result.reply?.proposals.map((p) => p.toolName)).toEqual(['list_projects']);
  });

  it('returns a graceful error message on schema validation failure', async () => {
    vi.mocked(invokeSkill).mockResolvedValueOnce({
      output: { not: 'the right shape' },
      decisionSummaries: [],
      events: [],
    });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_3',
    });
    expect(result.reply?.say).toMatch(/structured output failed validation/i);
  });

  it('returns reply: null when the runtime throws', async () => {
    vi.mocked(invokeSkill).mockRejectedValueOnce(new Error('subprocess died'));
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_4',
    });
    expect(result.reply).toBeNull();
  });

  it('emits chat.agent-thinking checkpoints around the skill invocation', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(invokeSkill).mockResolvedValueOnce({
      output: {
        say: 'sure.',
        proposals: [],
        done: false,
        decisionSummaries: [{ kind: 'PLAN', summary: 'ok.' }],
      },
      decisionSummaries: [],
      events: [],
    });
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_thinking',
    });
    const thinkingCalls = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.kind === 'chat.agent-thinking');
    expect(thinkingCalls).toHaveLength(2);
    const checkpoints = thinkingCalls.map((e) => (e.payload as { checkpoint?: string }).checkpoint);
    expect(checkpoints).toEqual(['skill-invoked', 'structured-output-received']);
    for (const e of thinkingCalls) {
      const payload = e.payload as { conversationId?: string; runId?: string };
      expect(payload.conversationId).toBe('conv_test');
      expect(payload.runId).toBe('chat_test_thinking');
      expect(e.runId).toBe('chat_test_thinking');
    }
  });

  it('emits the skill-invoked thinking event even when the run later throws', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(invokeSkill).mockRejectedValueOnce(new Error('boom'));
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_thinking_err',
    });
    const thinkingCalls = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.kind === 'chat.agent-thinking');
    // Only the pre-spawn checkpoint should fire on a thrown run.
    expect(thinkingCalls.map((e) => (e.payload as { checkpoint?: string }).checkpoint)).toEqual([
      'skill-invoked',
    ]);
  });
});
