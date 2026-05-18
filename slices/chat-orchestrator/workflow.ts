import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * M20 — chat-orchestrator slice.
 *
 * One call to `runChatOrchestratorTurn` advances exactly ONE turn of a
 * conversation between the user and the hub-chat assistant. The orchestrator
 * drives the loop across user messages; persistence lives in the chat domain.
 */
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { defaultModelForTierAndProvider } from '@goose-hub/core/agent-runtime/models.js';
import { toJsonSchema as zodToJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { listToolManifests } from '@goose-hub/core/chat-tools/registry.js';
import { listToolInvocations } from '@goose-hub/core/conversations/repository.js';
import type {
  ChatMessage,
  ChatToolInvocation,
  Conversation,
} from '@goose-hub/core/conversations/types.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import {
  type HubChatOutput,
  HubChatOutputSchema,
  type HubChatProposal,
} from '@goose-hub/skills/hub-chat/schema.js';
import type { z } from 'zod';

export interface ChatTurnInput {
  conversation: Conversation;
  history: ChatMessage[];
  runId: string;
}

export interface ChatTurnOutput {
  reply: HubChatOutput | null;
}

const GOVERNANCE_FILES = ['CLAUDE.md', 'MISSION.md', 'CONTEXT.md'] as const;

function readGovernanceDigest(): string {
  const root = process.env.GOOSE_HUB_ROOT ? process.env.GOOSE_HUB_ROOT : findRepoRoot();
  if (root == null) return '';
  const sections: string[] = [];
  for (const filename of GOVERNANCE_FILES) {
    try {
      const content = readFileSync(join(root, filename), 'utf-8');
      const heading = content.split('\n').slice(0, 80).join('\n');
      sections.push(`## ${filename} (first 80 lines)\n${heading}`);
    } catch {
      // best-effort; skip missing files
    }
  }
  return sections.join('\n\n');
}

function findRepoRoot(): string | null {
  // Walk up from this module looking for pnpm-workspace.yaml.
  try {
    let dir = new URL('.', import.meta.url).pathname;
    for (let i = 0; i < 8; i++) {
      try {
        readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8');
        return dir;
      } catch {
        dir = join(dir, '..');
      }
    }
  } catch {}
  return null;
}

function recentEventSlice(conversation: Conversation): Array<{
  kind: string;
  createdAt: string;
  projectId?: string;
  workItemId?: string | null;
  summary?: string;
}> {
  const events = eventStore.replay({
    projectId: conversation.projectId ?? undefined,
    workItemId: conversation.workItemId ?? undefined,
    order: 'desc',
    limit: 30,
  });
  return events.map((e) => {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const summary =
      (typeof payload.summary === 'string' && payload.summary) ||
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.skill === 'string' && `skill=${payload.skill}`) ||
      undefined;
    return {
      kind: e.kind,
      createdAt: e.createdAt,
      projectId: e.projectId,
      workItemId: e.workItemId,
      summary,
    };
  });
}

function buildContext(input: ChatTurnInput): Record<string, unknown> {
  const { conversation, history } = input;
  const manifests = listToolManifests().map((m) => ({
    name: m.name,
    description: m.description,
    mutating: m.mutating,
    inputSchemaJson: tryToJsonSchema(m.inputSchema),
  }));

  return {
    scope: {
      kind: conversation.scope,
      projectSlug: conversation.projectId ?? undefined,
      workItemId: conversation.workItemId ?? undefined,
    },
    conversationId: conversation.id,
    priorMessages: history.map((m) => ({ role: m.role, content: m.content })),
    availableTools: manifests,
    toolResults: priorToolResults(conversation.id),
    recentEvents: recentEventSlice(conversation),
    governanceDigest: readGovernanceDigest(),
  };
}

/**
 * Hydrate the prior tool-results for the conversation so the agent doesn't
 * re-run read-only tools whose results it can already see. We summarise only:
 * `proposed` invocations are intentionally suppressed because the agent
 * shouldn't reason as if they ran.
 */
function priorToolResults(conversationId: string): Array<{
  toolName: string;
  status: 'completed' | 'failed' | 'rejected' | 'pending';
  result?: unknown;
  errorMessage?: string;
}> {
  const invocations: ChatToolInvocation[] = listToolInvocations(conversationId);
  return invocations
    .filter((i) => i.status !== 'proposed' && i.status !== 'running' && i.status !== 'approved')
    .map((i) => ({
      toolName: i.toolName,
      status:
        i.status === 'completed'
          ? ('completed' as const)
          : i.status === 'failed'
            ? ('failed' as const)
            : i.status === 'rejected'
              ? ('rejected' as const)
              : ('pending' as const),
      result: i.result,
      errorMessage: i.errorMessage ?? undefined,
    }));
}

function tryToJsonSchema(schema: z.ZodType): unknown {
  try {
    return zodToJsonSchema(schema);
  } catch {
    return { type: 'object' };
  }
}

/**
 * Run one turn. Returns `{reply: null}` when the run fails so the caller can
 * fall back to a friendly error in the chat UI without blowing up.
 */
export async function runChatOrchestratorTurn(input: ChatTurnInput): Promise<ChatTurnOutput> {
  const { conversation, runId } = input;
  const context = buildContext(input);

  // Honour the user-picked runtime stored on the conversation. We map
  // claude→sonnet-claude and codex→sonnet-codex so the agent-runtime
  // dispatcher (`selectRuntime`) picks the right CLI via `providerOf()`.
  // This also overrides any project-level rolesModels entry that would
  // otherwise pin auditor to opus (and bust chat's $0.4 budget).
  const provider = conversation.runtime === 'codex' ? 'codex' : 'claude';
  const modelOverride = defaultModelForTierAndProvider('sonnet', provider);

  emitThinking(conversation, runId, 'skill-invoked');

  let invokeResult: Awaited<ReturnType<typeof invokeSkill>> | null = null;
  try {
    invokeResult = await invokeSkill({
      skillName: 'hub-chat',
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId ?? undefined,
      runId,
      context,
      overrides: { modelOverride },
    });
    emitThinking(conversation, runId, 'structured-output-received');
    const parsed = HubChatOutputSchema.safeParse(invokeResult.output);
    if (!parsed.success) {
      logger.warn('hub-chat: output validation failed', {
        runId,
        issues: parsed.error.issues,
      });
      // M20.14: count this turn as a failure for the picked persona so the
      // round-robin router can deprioritise personas that keep emitting
      // unparseable output.
      accumulatePersonaStats({
        personaName: invokeResult.personaId,
        role: invokeResult.role,
        outcome: 'failure',
      });
      return {
        reply: {
          say: 'I tried to reply but the structured output failed validation. Please try again.',
          proposals: [],
          done: false,
          decisionSummaries: [
            {
              kind: 'TOOL_FAILURE' as const,
              summary: 'hub-chat output failed schema validation',
            },
          ],
        },
      };
    }
    // Reconcile proposals: drop any whose toolName is unknown. The skill's
    // schema permits arbitrary strings for forwards-compat; this is the
    // hard gate before we hand off to the dispatcher.
    const validProposals = parsed.data.proposals.filter((p: HubChatProposal) =>
      manifestHas(p.toolName),
    );
    accumulatePersonaStats({
      personaName: invokeResult.personaId,
      role: invokeResult.role,
      outcome: 'success',
    });
    return {
      reply: {
        ...parsed.data,
        proposals: validProposals,
      },
    };
  } catch (err) {
    logger.error('chat orchestrator invokeSkill threw', { runId, err: String(err) });
    // Clear the thinking indicator the UI is now showing. The dispatch
    // wrapper only emits `chat.run-failed` from its own try/catch — we
    // swallow the throw and return `{reply: null}`, so without this emit
    // the in-flight indicator would never go away for this conversation.
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: conversation.workItemId,
      kind: 'chat.run-failed',
      payload: { conversationId: conversation.id, runId, error: String(err) },
      runId,
    });
    // Persona-stats failure path only when invokeSkill made it past
    // selectPersona — pre-spawn ContextValidationError throws before any
    // persona is picked, so `invokeResult` will still be null and we skip.
    if (invokeResult != null) {
      accumulatePersonaStats({
        personaName: invokeResult.personaId,
        role: invokeResult.role,
        outcome: 'failure',
      });
    }
    return { reply: null };
  }
}

function manifestHas(name: string): boolean {
  return listToolManifests().some((t) => t.name === name);
}

type ThinkingCheckpoint = 'skill-invoked' | 'structured-output-received';

function emitThinking(conversation: Conversation, runId: string, checkpoint: ThinkingCheckpoint) {
  eventStore.appendEvent({
    projectId: conversation.projectId ?? 'goose-hub-self',
    workItemId: conversation.workItemId,
    kind: 'chat.agent-thinking',
    payload: { conversationId: conversation.id, runId, checkpoint },
    runId,
  });
}
