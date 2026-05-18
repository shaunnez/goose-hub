import type {
  ChatConversationDto,
  ChatMessageDto,
  ChatRuntime,
  ChatScope,
  ChatToolInvocationDto,
  ChatToolManifestDto,
} from '../types.js';
import { deleteRequest, getJson, postJson } from './client.js';

export async function fetchToolManifest(): Promise<ChatToolManifestDto[]> {
  const { tools } = await getJson<{ tools: ChatToolManifestDto[] }>('/chat/manifest');
  return tools;
}

export async function createConversation(input: {
  scope?: ChatScope;
  projectSlug?: string | null;
  workItemId?: string | null;
  runtime?: ChatRuntime;
}): Promise<ChatConversationDto> {
  const { conversation } = await postJson<{ conversation: ChatConversationDto }>(
    '/chat/conversations',
    input,
  );
  return conversation;
}

export async function listConversations(filter: {
  scope?: ChatScope;
  projectSlug?: string;
  workItemId?: string;
}): Promise<ChatConversationDto[]> {
  const params = new URLSearchParams();
  if (filter.scope) params.set('scope', filter.scope);
  if (filter.projectSlug) params.set('projectSlug', filter.projectSlug);
  if (filter.workItemId) params.set('workItemId', filter.workItemId);
  const qs = params.toString();
  const { conversations } = await getJson<{ conversations: ChatConversationDto[] }>(
    `/chat/conversations${qs ? `?${qs}` : ''}`,
  );
  return conversations;
}

export interface FullConversation {
  conversation: ChatConversationDto;
  messages: ChatMessageDto[];
  invocations: ChatToolInvocationDto[];
}

export async function fetchConversation(id: string): Promise<FullConversation> {
  return getJson<FullConversation>(`/chat/conversations/${id}`);
}

export async function deleteConversation(id: string): Promise<void> {
  await deleteRequest(`/chat/conversations/${id}`);
}

export interface PostMessageResponse {
  user: ChatMessageDto;
  agent: ChatMessageDto | null;
  invocations: ChatToolInvocationDto[];
}

export async function postMessage(
  conversationId: string,
  content: string,
): Promise<PostMessageResponse> {
  return postJson<PostMessageResponse>(`/chat/conversations/${conversationId}/messages`, {
    content,
  });
}

export async function resolveInvocation(
  conversationId: string,
  invocationId: string,
  decision: 'approve' | 'reject',
): Promise<{ invocation: ChatToolInvocationDto }> {
  return postJson<{ invocation: ChatToolInvocationDto }>(
    `/chat/conversations/${conversationId}/invocations/${invocationId}`,
    { decision },
  );
}
