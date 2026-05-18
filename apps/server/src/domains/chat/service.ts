import { getToolManifest, listToolManifests } from '@goose-hub/core/chat-tools/registry.js';
import type {
  ChatMessage,
  ChatMessageRole,
  ChatToolInvocation,
  Conversation,
  ConversationRuntime,
  ConversationScope,
} from '@goose-hub/core/conversations/types.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { runChatTurn } from '#shared/chat-dispatch.js';
import type { Result } from '#shared/middleware.js';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getToolInvocation,
  listConversations,
  listMessages,
  listToolInvocations,
  recordToolInvocation,
  updateToolInvocation,
} from './repository.js';
import { CHAT_TOOL_IMPLEMENTATIONS, type ToolContext, ToolExecutionError } from './tools.js';

function newConversationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `conv_${ts}_${rand}`;
}

function newInvocationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `tool_${ts}_${rand}`;
}

function deriveTitle(content: string): string {
  const firstLine = content.split('\n')[0].trim();
  return firstLine.slice(0, 80);
}

export async function startConversation(input: {
  scope?: ConversationScope;
  projectSlug?: string | null;
  workItemId?: string | null;
  runtime?: ConversationRuntime;
}): Promise<Result<{ conversation: Conversation }>> {
  const scope = input.scope ?? 'global';
  if (scope === 'project' && !input.projectSlug)
    return { ok: false, error: 'projectSlug required for scope=project', status: 400 };
  if (scope === 'item' && (!input.projectSlug || !input.workItemId))
    return { ok: false, error: 'projectSlug + workItemId required for scope=item', status: 400 };

  const conversation = createConversation({
    id: newConversationId(),
    scope,
    projectId: input.projectSlug ?? null,
    workItemId: input.workItemId ?? null,
    runtime: input.runtime ?? 'claude',
  });
  return { ok: true, data: { conversation } };
}

export async function fetchConversation(id: string): Promise<
  Result<{
    conversation: Conversation;
    messages: ChatMessage[];
    invocations: ChatToolInvocation[];
  }>
> {
  const conversation = getConversation(id);
  if (conversation == null) return { ok: false, error: 'not found', status: 404 };
  const messages = listMessages(id);
  const invocations = listToolInvocations(id);
  return { ok: true, data: { conversation, messages, invocations } };
}

export async function listConversationsService(
  filter: {
    scope?: ConversationScope;
    projectSlug?: string;
    workItemId?: string;
  } = {},
): Promise<Result<{ conversations: Conversation[] }>> {
  const conversations = listConversations({
    scope: filter.scope,
    projectId: filter.projectSlug,
    workItemId: filter.workItemId,
    limit: 50,
  });
  return { ok: true, data: { conversations } };
}

export async function deleteConversationService(id: string): Promise<Result<{ ok: true }>> {
  if (getConversation(id) == null) return { ok: false, error: 'not found', status: 404 };
  deleteConversation(id);
  return { ok: true, data: { ok: true } };
}

/**
 * The user posted a message. We:
 *  1. Persist it.
 *  2. Emit `chat.user-message`.
 *  3. Hand it off to the chat orchestrator, which runs the hub-chat skill,
 *     persists the agent's reply, auto-runs any read-only tool proposals,
 *     and parks mutating proposals as 'proposed' for human approval.
 *
 * Returns the saved user message and the agent's reply once the run finishes.
 */
export async function postUserMessage(input: {
  conversationId: string;
  content: string;
}): Promise<
  Result<{
    user: ChatMessage;
    agent: ChatMessage | null;
    invocations: ChatToolInvocation[];
  }>
> {
  const conversation = getConversation(input.conversationId);
  if (conversation == null) return { ok: false, error: 'conversation not found', status: 404 };
  if (!input.content.trim()) return { ok: false, error: 'content required', status: 400 };

  // Persist the user turn first so the chat orchestrator reads it back.
  const user = appendMessage({
    conversationId: conversation.id,
    role: 'user',
    content: input.content,
    meta: { scope: conversation.scope, runtime: conversation.runtime },
  });

  // Stamp the first user turn as the conversation title (UX nicety).
  const allMessages = listMessages(conversation.id);
  if (allMessages.length === 1 && !conversation.title) {
    const repo = await import('@goose-hub/core/conversations/repository.js');
    repo.touchConversation(conversation.id, deriveTitle(input.content));
  }

  eventStore.appendEvent({
    projectId: conversation.projectId ?? 'goose-hub-self',
    workItemId: conversation.workItemId,
    kind: 'chat.user-message',
    payload: {
      conversationId: conversation.id,
      messageId: user.id,
      content: input.content,
    },
  });

  // Run one round of the chat orchestrator.
  try {
    const result = await runChatTurn(conversation);
    return {
      ok: true,
      data: {
        user,
        agent: result.agentMessage,
        invocations: result.invocations,
      },
    };
  } catch (err) {
    logger.error('chat orchestrator failed', { err: String(err), conversationId: conversation.id });
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.run-failed',
      payload: { conversationId: conversation.id, error: String(err) },
    });
    return {
      ok: true,
      data: { user, agent: null, invocations: listToolInvocations(conversation.id) },
    };
  }
}

export async function resolveProposal(input: {
  conversationId: string;
  invocationId: string;
  decision: 'approve' | 'reject';
}): Promise<Result<{ invocation: ChatToolInvocation }>> {
  const conversation = getConversation(input.conversationId);
  if (conversation == null) return { ok: false, error: 'conversation not found', status: 404 };

  const existing = getToolInvocation(input.invocationId);
  if (existing == null) return { ok: false, error: 'tool invocation not found', status: 404 };
  if (existing.status !== 'proposed')
    return { ok: false, error: `invocation already ${existing.status}`, status: 409 };

  if (input.decision === 'reject') {
    const updated = updateToolInvocation({ id: input.invocationId, status: 'rejected' });
    if (updated == null) return { ok: false, error: 'update failed', status: 500 };
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.tool-rejected',
      payload: {
        conversationId: conversation.id,
        invocationId: existing.id,
        toolName: existing.toolName,
      },
    });
    return { ok: true, data: { invocation: updated } };
  }

  // Approve → execute through the same dispatcher path the chat orchestrator uses.
  eventStore.appendEvent({
    projectId: conversation.projectId ?? 'goose-hub-self',
    workItemId: conversation.workItemId,
    kind: 'chat.tool-approved',
    payload: {
      conversationId: conversation.id,
      invocationId: existing.id,
      toolName: existing.toolName,
    },
  });
  const result = await executeInvocation(conversation, existing.id);
  return { ok: true, data: { invocation: result } };
}

/**
 * Execute a tool invocation by id. Used by:
 *   - the chat orchestrator for read-only tools (synchronous, post-proposal)
 *   - resolveProposal() when the human approves a mutating tool
 */
export async function executeInvocation(
  conversation: Conversation,
  invocationId: string,
): Promise<ChatToolInvocation> {
  const invocation = getToolInvocation(invocationId);
  if (invocation == null) throw new Error(`invocation ${invocationId} not found`);

  const manifest = getToolManifest(invocation.toolName);
  if (manifest == null) {
    const failed = updateToolInvocation({
      id: invocationId,
      status: 'failed',
      errorMessage: `unknown tool '${invocation.toolName}'`,
    });
    return failed ?? invocation;
  }
  const impl = CHAT_TOOL_IMPLEMENTATIONS[invocation.toolName];
  if (impl == null) {
    const failed = updateToolInvocation({
      id: invocationId,
      status: 'failed',
      errorMessage: `no implementation for tool '${invocation.toolName}'`,
    });
    return failed ?? invocation;
  }

  // Validate input against the manifest's schema before executing.
  const parsed = manifest.inputSchema.safeParse(invocation.input);
  if (!parsed.success) {
    const failed = updateToolInvocation({
      id: invocationId,
      status: 'failed',
      errorMessage: `input validation failed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    });
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.tool-failed',
      payload: {
        conversationId: conversation.id,
        invocationId,
        toolName: invocation.toolName,
        error: failed?.errorMessage,
      },
    });
    return failed ?? invocation;
  }

  updateToolInvocation({ id: invocationId, status: 'running' });
  eventStore.appendEvent({
    projectId: conversation.projectId ?? 'goose-hub-self',
    workItemId: conversation.workItemId,
    kind: 'chat.tool-running',
    payload: { conversationId: conversation.id, invocationId, toolName: invocation.toolName },
  });

  const ctx: ToolContext = {
    conversationId: conversation.id,
    projectId: conversation.projectId,
    workItemId: conversation.workItemId,
  };

  try {
    const result = await impl(parsed.data, ctx);
    const completed = updateToolInvocation({ id: invocationId, status: 'completed', result });
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.tool-completed',
      payload: {
        conversationId: conversation.id,
        invocationId,
        toolName: invocation.toolName,
        result,
      },
    });
    return completed ?? invocation;
  } catch (err) {
    const message = err instanceof ToolExecutionError ? err.message : String(err);
    const failed = updateToolInvocation({
      id: invocationId,
      status: 'failed',
      errorMessage: message,
    });
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.tool-failed',
      payload: {
        conversationId: conversation.id,
        invocationId,
        toolName: invocation.toolName,
        error: message,
      },
    });
    return failed ?? invocation;
  }
}

/**
 * Helper used by the chat orchestrator: persist a proposal coming from the
 * agent's structured output and decide whether to auto-execute it
 * (read-only) or park it for human approval (mutating).
 */
export async function persistAndMaybeRunProposal(
  conversation: Conversation,
  messageId: number | null,
  proposal: { toolName: string; input: Record<string, unknown>; rationale: string },
): Promise<ChatToolInvocation> {
  const manifest = getToolManifest(proposal.toolName);
  const mutating = manifest?.mutating ?? true;
  const id = newInvocationId();
  const invocation = recordToolInvocation({
    id,
    conversationId: conversation.id,
    messageId,
    toolName: proposal.toolName,
    input: { ...proposal.input, _rationale: proposal.rationale },
    mutating,
    status: mutating ? 'proposed' : 'running',
  });

  eventStore.appendEvent({
    projectId: conversation.projectId ?? 'goose-hub-self',
    workItemId: conversation.workItemId,
    kind: 'chat.tool-proposed',
    payload: {
      conversationId: conversation.id,
      invocationId: invocation.id,
      toolName: invocation.toolName,
      mutating,
      rationale: proposal.rationale,
    },
  });

  if (!mutating) {
    return executeInvocation(conversation, invocation.id);
  }
  return invocation;
}

export { listToolManifests };
