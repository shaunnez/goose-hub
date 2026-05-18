import {
  appendMessage,
  listMessages,
  listToolInvocations,
} from '@goose-hub/core/conversations/repository.js';
import type {
  ChatMessage,
  ChatToolInvocation,
  Conversation,
} from '@goose-hub/core/conversations/types.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { sliceUrl } from './slice-url.js';

interface ChatOrchestratorModule {
  runChatOrchestratorTurn: (input: {
    conversation: Conversation;
    history: ChatMessage[];
    runId: string;
  }) => Promise<{
    reply: {
      say: string;
      proposals: Array<{ toolName: string; input: Record<string, unknown>; rationale: string }>;
      done: boolean;
      decisionSummaries: Array<{ kind: string; summary: string; evidence?: string }>;
    } | null;
  }>;
}

export interface ChatTurnResult {
  agentMessage: ChatMessage | null;
  invocations: ChatToolInvocation[];
}

function newRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `chat_${ts}_${rand}`;
}

/**
 * Drive one turn of the chat orchestrator. Called by the chat service after
 * persisting a user message. The orchestrator:
 *   1. Reads the conversation history from chat_messages
 *   2. Invokes the hub-chat skill
 *   3. Persists the agent reply
 *   4. Auto-runs read-only tool proposals, parks mutating ones
 *
 * Errors are caught here and turned into chat.run-failed events so the UI can
 * surface them without taking the server down. The function still returns
 * cleanly with `agentMessage: null` so the caller can render a friendly error.
 */
export async function runChatTurn(conversation: Conversation): Promise<ChatTurnResult> {
  const runId = newRunId();
  const history = listMessages(conversation.id);

  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const orchestrator = (await import(sliceUrl('chat-orchestrator'))) as ChatOrchestratorModule;
    const result = await orchestrator.runChatOrchestratorTurn({
      conversation,
      history,
      runId,
    });
    if (result.reply == null) {
      return { agentMessage: null, invocations: listToolInvocations(conversation.id) };
    }
    const agentMessage = appendMessage({
      conversationId: conversation.id,
      role: 'agent',
      content: result.reply.say,
      runId,
      meta: {
        proposals: result.reply.proposals,
        done: result.reply.done,
        decisionSummaries: result.reply.decisionSummaries,
      },
    });
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.agent-message',
      payload: {
        conversationId: conversation.id,
        messageId: agentMessage.id,
        runId,
        content: result.reply.say,
      },
      runId,
    });

    // Hand off proposals to the chat service for proposal persistence + dispatch.
    // case 4: test stub injection — defer import to break the cycle with service.ts.
    const service = await import('../domains/chat/service.js');
    for (const proposal of result.reply.proposals) {
      await service.persistAndMaybeRunProposal(conversation, agentMessage.id, proposal);
    }
    return { agentMessage, invocations: listToolInvocations(conversation.id) };
  } catch (err) {
    logger.error('chat orchestrator turn failed', {
      err: String(err),
      conversationId: conversation.id,
    });
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.run-failed',
      payload: { conversationId: conversation.id, error: String(err), runId },
      runId,
    });
    return { agentMessage: null, invocations: listToolInvocations(conversation.id) };
  }
}
