import type { z } from 'zod';

/**
 * A chat tool is a side-effect or read-only operation the chat agent can
 * invoke. Read-only tools auto-execute. Mutating tools insert as 'proposed'
 * and wait for the human to approve in the UI before the dispatcher runs them.
 */
export interface ChatToolContext {
  /** Conversation that issued the call — used to scope event emission. */
  conversationId: string;
  /** Project the conversation is currently scoped to, when available. */
  projectId?: string | null;
  /** Work item the conversation is currently scoped to, when available. */
  workItemId?: string | null;
}

export interface ChatTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** True if the tool changes state and must be human-approved before running. */
  mutating: boolean;
  inputSchema: z.ZodType<TInput>;
  /** Pure side-effect-free execution. Throws on error; dispatcher catches. */
  execute(input: TInput, ctx: ChatToolContext): Promise<TOutput>;
}

export class ChatToolUnknownError extends Error {
  constructor(toolName: string) {
    super(`chat-tools: unknown tool '${toolName}'`);
    this.name = 'ChatToolUnknownError';
  }
}

export class ChatToolValidationError extends Error {
  issues: Array<{ path: Array<string | number>; message: string }>;
  constructor(toolName: string, issues: Array<{ path: Array<string | number>; message: string }>) {
    super(`chat-tools: input validation failed for '${toolName}'`);
    this.name = 'ChatToolValidationError';
    this.issues = issues;
  }
}
