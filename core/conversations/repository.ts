import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { chatConversations, chatMessages, chatToolInvocations } from '../db/schema.js';
import type {
  ChatMessage,
  ChatMessageRole,
  ChatToolInvocation,
  ChatToolStatus,
  Conversation,
  ConversationRuntime,
  ConversationScope,
} from './types.js';

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function rowToConversation(r: typeof chatConversations.$inferSelect): Conversation {
  return {
    id: r.id,
    scope: r.scope as ConversationScope,
    projectId: r.projectId,
    workItemId: r.workItemId,
    title: r.title,
    runtime: r.runtime as ConversationRuntime,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function rowToMessage(r: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: r.id,
    conversationId: r.conversationId,
    role: r.role as ChatMessageRole,
    content: r.content,
    runId: r.runId,
    meta: r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : null,
    createdAt: r.createdAt,
  };
}

function rowToInvocation(r: typeof chatToolInvocations.$inferSelect): ChatToolInvocation {
  return {
    id: r.id,
    conversationId: r.conversationId,
    messageId: r.messageId,
    toolName: r.toolName,
    input: JSON.parse(r.inputJson) as Record<string, unknown>,
    mutating: r.mutating,
    status: r.status as ChatToolStatus,
    result: r.resultJson ? JSON.parse(r.resultJson) : null,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export interface CreateConversationInput {
  id: string;
  scope: ConversationScope;
  projectId?: string | null;
  workItemId?: string | null;
  runtime?: ConversationRuntime;
  title?: string;
}

export function createConversation(input: CreateConversationInput): Conversation {
  const [row] = db
    .insert(chatConversations)
    .values({
      id: input.id,
      scope: input.scope,
      projectId: input.projectId ?? null,
      workItemId: input.workItemId ?? null,
      title: input.title ?? '',
      runtime: input.runtime ?? 'claude',
    })
    .returning()
    .all();
  return rowToConversation(row);
}

export function getConversation(id: string): Conversation | null {
  const [row] = db.select().from(chatConversations).where(eq(chatConversations.id, id)).all();
  return row ? rowToConversation(row) : null;
}

export function listConversations(
  filter: {
    scope?: ConversationScope;
    projectId?: string;
    workItemId?: string;
    limit?: number;
  } = {},
): Conversation[] {
  const conds = [];
  if (filter.scope) conds.push(eq(chatConversations.scope, filter.scope));
  if (filter.projectId) conds.push(eq(chatConversations.projectId, filter.projectId));
  if (filter.workItemId) conds.push(eq(chatConversations.workItemId, filter.workItemId));

  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

  const query =
    where != null
      ? db.select().from(chatConversations).where(where).orderBy(desc(chatConversations.updatedAt))
      : db.select().from(chatConversations).orderBy(desc(chatConversations.updatedAt));

  const rows = filter.limit ? query.limit(filter.limit).all() : query.all();
  return rows.map(rowToConversation);
}

export function touchConversation(id: string, title?: string): void {
  const update: { updatedAt: string; title?: string } = { updatedAt: nowIso() };
  if (title != null) update.title = title;
  db.update(chatConversations).set(update).where(eq(chatConversations.id, id)).run();
}

export interface AppendMessageInput {
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  runId?: string | null;
  meta?: Record<string, unknown> | null;
}

export function appendMessage(input: AppendMessageInput): ChatMessage {
  const [row] = db
    .insert(chatMessages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      runId: input.runId ?? null,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
    })
    .returning()
    .all();
  touchConversation(input.conversationId);
  return rowToMessage(row);
}

export function listMessages(conversationId: string, limit?: number): ChatMessage[] {
  const query = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.id));
  const rows = limit ? query.limit(limit).all() : query.all();
  return rows.map(rowToMessage);
}

export interface RecordToolInvocationInput {
  id: string;
  conversationId: string;
  messageId?: number | null;
  toolName: string;
  input: Record<string, unknown>;
  mutating: boolean;
  status: ChatToolStatus;
}

export function recordToolInvocation(input: RecordToolInvocationInput): ChatToolInvocation {
  const [row] = db
    .insert(chatToolInvocations)
    .values({
      id: input.id,
      conversationId: input.conversationId,
      messageId: input.messageId ?? null,
      toolName: input.toolName,
      inputJson: JSON.stringify(input.input),
      mutating: input.mutating,
      status: input.status,
    })
    .returning()
    .all();
  return rowToInvocation(row);
}

export interface UpdateToolInvocationInput {
  id: string;
  status: ChatToolStatus;
  result?: unknown;
  errorMessage?: string | null;
}

export function updateToolInvocation(input: UpdateToolInvocationInput): ChatToolInvocation | null {
  const update: Record<string, unknown> = {
    status: input.status,
    updatedAt: nowIso(),
  };
  if (input.result !== undefined) update.resultJson = JSON.stringify(input.result);
  if (input.errorMessage !== undefined) update.errorMessage = input.errorMessage;

  const [row] = db
    .update(chatToolInvocations)
    .set(update)
    .where(eq(chatToolInvocations.id, input.id))
    .returning()
    .all();
  return row ? rowToInvocation(row) : null;
}

export function getToolInvocation(id: string): ChatToolInvocation | null {
  const [row] = db.select().from(chatToolInvocations).where(eq(chatToolInvocations.id, id)).all();
  return row ? rowToInvocation(row) : null;
}

export function listToolInvocations(conversationId: string): ChatToolInvocation[] {
  const rows = db
    .select()
    .from(chatToolInvocations)
    .where(eq(chatToolInvocations.conversationId, conversationId))
    .orderBy(asc(chatToolInvocations.createdAt))
    .all();
  return rows.map(rowToInvocation);
}

export function deleteConversation(id: string): void {
  db.delete(chatMessages).where(eq(chatMessages.conversationId, id)).run();
  db.delete(chatToolInvocations).where(eq(chatToolInvocations.conversationId, id)).run();
  db.delete(chatConversations).where(eq(chatConversations.id, id)).run();
}
