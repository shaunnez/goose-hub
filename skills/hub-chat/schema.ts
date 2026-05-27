import { ChatToolNameSchema } from '@goose-hub/core/chat-tools/registry.js';
import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * Output schema for one turn of the hub-chat assistant.
 *
 * The agent ALWAYS returns a discriminated union of replies. Each turn is a
 * single reply that may include:
 *  - `say`: a chat message the user sees (always present)
 *  - `proposals`: zero or more proposed tool calls; the orchestrator decodes
 *    `input` from JSON text, then decides whether to auto-run (read-only) or
 *    wait for human approval (mutating)
 *  - `done`: true when the assistant believes the conversation has a natural
 *    pause point — UI uses this for visual affordances; not a hard stop
 *
 * Free-text-only output fails the run. Tool names must come from
 * `CHAT_TOOL_REGISTRY` in `core/chat-tools/registry.ts`. The orchestrator
 * validates each proposal's input against its registered Zod schema before
 * the dispatcher runs it.
 */
export const HubChatProposalSchema = z.object({
  toolName: ChatToolNameSchema.describe('Must match a name in core/chat-tools/registry.ts'),
  input: z
    .string()
    .min(2)
    .describe("JSON-encoded object matching the tool's declared inputSchema."),
  rationale: z
    .string()
    .describe(
      'One sentence shown in the tool card. Use conditional approval wording only for mutating tools; read-only tools auto-run.',
    ),
});

export const HubChatOutputSchema = z.object({
  say: z
    .string()
    .min(1)
    .describe(
      'The user-facing reply. Plain text or markdown. Always present, even when proposing tools.',
    ),
  proposals: z.array(HubChatProposalSchema).max(5).default([]),
  done: z.boolean().default(false),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type HubChatWireOutput = z.infer<typeof HubChatOutputSchema>;
export type HubChatWireProposal = z.infer<typeof HubChatProposalSchema>;
export type HubChatProposal = Omit<HubChatWireProposal, 'input'> & {
  input: Record<string, unknown>;
};
export type HubChatOutput = Omit<HubChatWireOutput, 'proposals'> & {
  proposals: HubChatProposal[];
};
