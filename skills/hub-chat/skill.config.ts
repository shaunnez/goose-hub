import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { HubChatOutputSchema } from './schema.js';

/**
 * Per-turn context schema for the hub-chat assistant.
 *
 * The chat orchestrator reconstructs the full conversation from the
 * `chat_messages` table and passes it in `priorMessages`. `availableTools` is
 * the manifest of tools the agent may propose this turn — derived from
 * `CHAT_TOOL_REGISTRY` and trimmed to whatever scope makes sense for the
 * conversation (e.g. project-scope conversations never see `list_projects`).
 *
 * `recentEvents` are a small slice of the event stream, already filtered to
 * the conversation's scope, so the agent can answer "what is the orchestrator
 * doing right now" without having to call a tool first.
 */
export const HubChatPriorMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  content: z.string(),
});

export const HubChatToolManifestSchema = z.object({
  name: z.string(),
  description: z.string(),
  mutating: z.boolean(),
  inputSchemaJson: z.unknown(),
});

export const HubChatToolResultSchema = z.object({
  toolName: z.string(),
  status: z.enum(['completed', 'failed', 'rejected', 'pending']),
  result: z.unknown().optional(),
  errorMessage: z.string().optional(),
});

export const HubChatScopeSchema = z.object({
  kind: z.enum(['global', 'project', 'item']),
  projectSlug: z.string().optional(),
  workItemId: z.string().optional(),
});

export const HubChatContextSchema = z.object({
  scope: HubChatScopeSchema,
  conversationId: z.string(),
  priorMessages: z.array(HubChatPriorMessageSchema),
  availableTools: z.array(HubChatToolManifestSchema),
  /** Resolved results of any tool calls executed this conversation, ordered. */
  toolResults: z.array(HubChatToolResultSchema).default([]),
  /** Compact recent event-stream slice for situational awareness. Optional. */
  recentEvents: z
    .array(
      z.object({
        kind: z.string(),
        createdAt: z.string(),
        projectId: z.string().optional(),
        workItemId: z.string().nullable().optional(),
        summary: z.string().optional(),
      }),
    )
    .default([]),
  /** Cheat-sheet of governance vocabulary loaded from CLAUDE.md / MISSION.md / CONTEXT.md. */
  governanceDigest: z.string().default(''),
});

const config: SkillConfig = {
  contextSchema: HubChatContextSchema,
  outputSchema: HubChatOutputSchema,
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: false,
  // Hub Chat surveys state and surfaces what the user should attend to.
  // Runs under the dedicated `assistant` role (M20.17) — non-holdout, broad
  // read, sonnet-tier baseline. Was previously sharing the `auditor` role
  // with code-quality-audit, which conflated persona stats and retrospective
  // groupings across two distinct operational profiles.
  role: 'assistant',
  contextAllowlist: [
    'scope',
    'conversationId',
    'priorMessages',
    'availableTools',
    'toolResults',
    'recentEvents',
    'governanceDigest',
  ],
};

export default config;
