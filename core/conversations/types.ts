export type ConversationScope = 'global' | 'project' | 'item';
export type ConversationRuntime = 'claude' | 'codex';
export type ChatMessageRole = 'user' | 'agent';
export type ChatToolStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'completed'
  | 'failed';

export interface Conversation {
  id: string;
  scope: ConversationScope;
  projectId: string | null;
  workItemId: string | null;
  title: string;
  runtime: ConversationRuntime;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  runId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatToolInvocation {
  id: string;
  conversationId: string;
  messageId: number | null;
  toolName: string;
  input: Record<string, unknown>;
  mutating: boolean;
  status: ChatToolStatus;
  result: unknown;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
