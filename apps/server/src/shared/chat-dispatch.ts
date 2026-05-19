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
import { getWorkItemSnapshot, issueNumberFromWorkItemId } from './work-item-snapshot.js';

interface ChatOrchestratorModule {
  runChatOrchestratorTurn: (input: {
    conversation: Conversation;
    history: ChatMessage[];
    runId: string;
    issueContext?: Record<string, unknown> | null;
  }) => Promise<{
    reply: {
      say: string;
      proposals: Array<{ toolName: string; input: Record<string, unknown>; rationale: string }>;
      done: boolean;
      decisionSummaries: Array<{ kind: string; summary: string; evidence?: string }>;
    } | null;
    telemetry?: ChatTurnTelemetry;
  }>;
}

export interface ChatTurnResult {
  agentMessage: ChatMessage | null;
  invocations: ChatToolInvocation[];
  telemetry?: ChatTurnTelemetry;
}

interface ChatTurnTelemetry {
  durationMs?: {
    total?: number;
    contextBuild?: number;
    modelInvocation?: number;
    postModelParsing?: number;
    toolExecution?: number;
  };
  tokens?: unknown;
  context?: unknown;
}

export function newChatRunId(): string {
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
export async function runChatTurn(
  conversation: Conversation,
  runId = newChatRunId(),
): Promise<ChatTurnResult> {
  const history = listMessages(conversation.id);

  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const orchestrator = (await import(sliceUrl('chat-orchestrator'))) as ChatOrchestratorModule;
    const issueContext = await buildIssueContext(conversation);
    const result = await orchestrator.runChatOrchestratorTurn({
      conversation,
      history,
      runId,
      issueContext,
    });
    if (result.reply == null) {
      return {
        agentMessage: null,
        invocations: listToolInvocations(conversation.id),
        telemetry: result.telemetry,
      };
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

    // Hand off proposals to the chat service for proposal persistence + dispatch.
    // case 4: test stub injection — defer import to break the cycle with service.ts.
    const service = await import('../domains/chat/service.js');
    const toolsStarted = Date.now();
    for (const proposal of result.reply.proposals) {
      await service.persistAndMaybeRunProposal(conversation, agentMessage.id, proposal);
    }
    const toolExecutionMs = Math.max(0, Date.now() - toolsStarted);
    const telemetry = attachToolDuration(result.telemetry, toolExecutionMs);

    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.agent-message',
      payload: {
        conversationId: conversation.id,
        messageId: agentMessage.id,
        runId,
        content: result.reply.say,
        telemetry,
      },
      runId,
    });

    return { agentMessage, invocations: listToolInvocations(conversation.id), telemetry };
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

async function buildIssueContext(
  conversation: Conversation,
): Promise<Record<string, unknown> | null> {
  if (conversation.scope !== 'item' || !conversation.projectId || !conversation.workItemId) {
    return null;
  }
  try {
    return await getWorkItemSnapshot(
      conversation.projectId,
      issueNumberFromWorkItemId(conversation.workItemId),
      {
        depth: 'compact',
        sections: ['issue', 'code', 'qa', 'review', 'costs', 'timeline', 'artifacts'],
        timelineLimit: 5,
      },
    );
  } catch (err) {
    logger.warn('chat issue-context snapshot failed', {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      workItemId: conversation.workItemId,
      err: String(err),
    });
    return {
      error: String(err),
      projectSlug: conversation.projectId,
      workItemId: conversation.workItemId,
    };
  }
}

function attachToolDuration(
  telemetry: ChatTurnTelemetry | undefined,
  toolExecutionMs: number,
): ChatTurnTelemetry | undefined {
  if (telemetry?.durationMs == null) return telemetry;
  const previousTotal = telemetry.durationMs.total ?? 0;
  return {
    ...telemetry,
    durationMs: {
      ...telemetry.durationMs,
      toolExecution: toolExecutionMs,
      total: previousTotal + toolExecutionMs,
    },
  };
}
