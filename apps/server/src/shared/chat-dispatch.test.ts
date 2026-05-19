import { createConversation } from '@goose-hub/core/conversations/repository.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChatTurn } from './chat-dispatch.js';

const mocks = vi.hoisted(() => ({
  persistAndMaybeRunProposal: vi.fn(),
  runChatOrchestratorTurn: vi.fn(),
}));

vi.mock('./slice-url.js', () => ({
  sliceUrl: () => 'virtual:chat-orchestrator',
}));

vi.mock('virtual:chat-orchestrator', () => ({
  runChatOrchestratorTurn: mocks.runChatOrchestratorTurn,
}));

vi.mock('../domains/chat/service.js', () => ({
  persistAndMaybeRunProposal: mocks.persistAndMaybeRunProposal,
}));

describe('runChatTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the agent message before proposal dispatch can execute tools', async () => {
    const projectId = `chat-dispatch-${Date.now()}`;
    const runId = `chat_run_${Date.now()}`;
    const conversation = createConversation({
      id: `conv_${Date.now()}`,
      scope: 'project',
      projectId,
    });
    mocks.runChatOrchestratorTurn.mockResolvedValueOnce({
      reply: {
        say: 'I found the next thing to check.',
        proposals: [{ toolName: 'recent_events', input: {}, rationale: 'inspect status' }],
        done: false,
        decisionSummaries: [],
      },
      telemetry: {
        durationMs: {
          total: 42,
          contextBuild: 5,
          modelInvocation: 30,
          postModelParsing: 7,
        },
      },
    });
    mocks.persistAndMaybeRunProposal.mockImplementationOnce(async () => {
      expect(eventStore.replay({ projectId }).map((event) => event.kind)).toContain(
        'chat.agent-message',
      );
      return {
        id: 'tool_test',
        conversationId: conversation.id,
        messageId: 1,
        toolName: 'recent_events',
        input: {},
        mutating: false,
        status: 'running',
        result: null,
        errorMessage: null,
        runId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    const result = await runChatTurn(conversation, runId);

    expect(result.agentMessage?.content).toBe('I found the next thing to check.');
    expect(mocks.persistAndMaybeRunProposal).toHaveBeenCalledWith(
      conversation,
      result.agentMessage?.id,
      { toolName: 'recent_events', input: {}, rationale: 'inspect status' },
    );
    const agentEvent = eventStore
      .replay({ projectId, runId })
      .find((event) => event.kind === 'chat.agent-message');
    expect(agentEvent?.payload).toEqual(
      expect.objectContaining({
        conversationId: conversation.id,
        content: 'I found the next thing to check.',
        telemetry: expect.objectContaining({
          durationMs: expect.objectContaining({
            contextBuild: 5,
            modelInvocation: 30,
            postModelParsing: 7,
            toolExecution: 0,
          }),
        }),
      }),
    );
  });
});
