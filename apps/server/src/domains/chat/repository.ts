/**
 * Thin re-export layer so the chat domain matches the documented router →
 * service → repository contract. All real persistence lives in
 * `@goose-hub/core/conversations/repository.js`.
 */
export {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getToolInvocation,
  listConversations,
  listMessages,
  listToolInvocations,
  recordToolInvocation,
  touchConversation,
  updateToolInvocation,
} from '@goose-hub/core/conversations/repository.js';

export type {
  ChatMessage,
  ChatMessageRole,
  ChatToolInvocation,
  ChatToolStatus,
  Conversation,
  ConversationRuntime,
  ConversationScope,
} from '@goose-hub/core/conversations/types.js';
