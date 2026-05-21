/**
 * M20 — chat-orchestrator slice.
 *
 * One call to `runChatOrchestratorTurn` advances exactly ONE turn of a
 * conversation between the user and the hub-chat assistant. The orchestrator
 * drives the loop across user messages; persistence lives in the chat domain.
 */
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { defaultModelForTierAndProvider } from '@goose-hub/core/agent-runtime/models.js';
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
  type HubChatWireProposal,
} from '@goose-hub/skills/hub-chat/schema.js';

export interface ChatTurnInput {
  conversation: Conversation;
  history: ChatMessage[];
  runId: string;
  issueContext?: Record<string, unknown> | null;
}

export interface ChatTurnOutput {
  reply: HubChatOutput | null;
  telemetry: ChatTurnTelemetry;
}

export interface ChatTurnTelemetry {
  durationMs: {
    total: number;
    contextBuild: number;
    modelInvocation: number;
    postModelParsing: number;
    toolExecution: number;
  };
  tokens: {
    actualInput: number | null;
    actualOutput: number | null;
    estimatedInput: {
      total: number;
      contextSections: {
        priorMessages: number;
        availableTools: number;
        toolResults: number;
        recentEvents: number;
        issueContext: number;
        governanceDigest: number;
        conversationSummary: number;
      };
    };
  };
  context: {
    priorMessagesSent: number;
    priorMessagesSummarized: number;
    availableToolsSent: number;
    toolResultsSent: number;
    recentEventsSent: number;
    governanceDigestIncluded: boolean;
  };
}

interface BuiltChatContext {
  context: Record<string, unknown>;
  telemetry: Pick<ChatTurnTelemetry, 'tokens' | 'context'>;
}

const RECENT_MESSAGE_LIMIT = 8;
const TOOL_RESULT_LIMIT = 6;
const TOOL_RESULT_VALUE_CHAR_LIMIT = 1_200;
const TOOL_RESULT_MATCH_CHAR_LIMIT = 3_000;
const RECENT_EVENT_LIMIT = 12;
const SUMMARY_CHAR_LIMIT = 1_400;
const EVENT_SUMMARY_CHAR_LIMIT = 240;
const CHAT_EVENT_WORK_ITEM_ID = null;

const FIRST_TURN_GOVERNANCE_DIGEST = [
  'Goose Hub is the product; Factory is the orchestration engine inside it.',
  'Use Factory vocabulary: Work item, state, lane, Source of Truth, workflow, agent run.',
  'Work-item state lives on issues, not PRs; PR labels are decorative.',
  'Mutating chat tools require human approval; read-only chat tools may auto-run.',
  'Use app links like /projects/<slug>/items/<issueNumber>; never put internal github:owner/repo#n ids in app URLs.',
].join('\n');

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
    limit: RECENT_EVENT_LIMIT,
  });
  return events.map((e) => {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const summary =
      (typeof payload.summary === 'string' && payload.summary) ||
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.error === 'string' && payload.error) ||
      (typeof payload.skill === 'string' && `skill=${payload.skill}`) ||
      undefined;
    return {
      kind: e.kind,
      createdAt: e.createdAt,
      projectId: e.projectId,
      workItemId: e.workItemId,
      summary: truncate(summary, EVENT_SUMMARY_CHAR_LIMIT),
    };
  });
}

function buildContext(input: ChatTurnInput): BuiltChatContext {
  const { conversation, history } = input;
  const manifests = listToolManifests().map((m) => ({
    name: m.name,
    description: m.description,
    mutating: m.mutating,
  }));
  const recentMessages = history.slice(-RECENT_MESSAGE_LIMIT);
  const summarizedMessages = history.slice(0, Math.max(0, history.length - RECENT_MESSAGE_LIMIT));
  const governanceDigest = history.length <= 1 ? FIRST_TURN_GOVERNANCE_DIGEST : '';

  const context = {
    scope: {
      kind: conversation.scope,
      projectSlug: conversation.projectId ?? undefined,
      workItemId: conversation.workItemId ?? undefined,
    },
    conversationId: conversation.id,
    conversationSummary: summarizePriorMessages(summarizedMessages),
    priorMessages: recentMessages.map((m) => ({ role: m.role, content: m.content })),
    availableTools: manifests,
    toolResults: priorToolResults(conversation.id, latestUserMessage(history)),
    recentEvents: recentEventSlice(conversation),
    issueContext: input.issueContext ?? null,
    governanceDigest,
  };

  return {
    context,
    telemetry: {
      tokens: {
        actualInput: null,
        actualOutput: null,
        estimatedInput: estimateContextTokens(context),
      },
      context: {
        priorMessagesSent: recentMessages.length,
        priorMessagesSummarized: summarizedMessages.length,
        availableToolsSent: manifests.length,
        toolResultsSent: context.toolResults.length,
        recentEventsSent: context.recentEvents.length,
        governanceDigestIncluded: governanceDigest.length > 0,
      },
    },
  };
}

/**
 * Hydrate the prior tool-results for the conversation so the agent doesn't
 * re-run read-only tools whose results it can already see. We summarise only:
 * `proposed` invocations are intentionally suppressed because the agent
 * shouldn't reason as if they ran.
 */
function priorToolResults(
  conversationId: string,
  latestUser: string,
): Array<{
  toolName: string;
  status: 'completed' | 'failed' | 'rejected' | 'pending';
  result?: unknown;
  errorMessage?: string;
}> {
  const invocations: ChatToolInvocation[] = listToolInvocations(conversationId);
  const candidates = invocations
    .filter((i) => i.status !== 'proposed' && i.status !== 'running' && i.status !== 'approved')
    .map((i) => {
      const compact = {
        toolName: i.toolName,
        status:
          i.status === 'completed'
            ? ('completed' as const)
            : i.status === 'failed'
              ? ('failed' as const)
              : i.status === 'rejected'
                ? ('rejected' as const)
                : ('pending' as const),
        result: compactValue(i.result),
        errorMessage: truncate(i.errorMessage ?? undefined, 300),
      };
      return {
        invocation: i,
        compact,
        relevant: isToolResultRelevant(i, latestUser),
      };
    })
    .sort((a, b) => {
      if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
      return Date.parse(b.invocation.updatedAt) - Date.parse(a.invocation.updatedAt);
    })
    .slice(0, TOOL_RESULT_LIMIT)
    .map(({ compact }) => compact);
  return candidates.map((i) => ({
    toolName: i.toolName,
    status: i.status,
    result: i.result,
    errorMessage: i.errorMessage,
  }));
}

function latestUserMessage(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') return history[i].content;
  }
  return '';
}

function summarizePriorMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) return '';
  const lines = messages.map((m) => {
    const label = m.role === 'user' ? 'User' : 'Hub Chat';
    return `- ${label}: ${truncate(oneLine(m.content), 180)}`;
  });
  return (
    truncate(
      `Earlier conversation (${messages.length} messages):\n${lines.join('\n')}`,
      SUMMARY_CHAR_LIMIT,
    ) ?? ''
  );
}

function isToolResultRelevant(invocation: ChatToolInvocation, latestUser: string): boolean {
  if (!latestUser.trim()) return false;
  const haystack = `${invocation.toolName} ${stringifyForMatch(invocation.result)} ${
    invocation.errorMessage ?? ''
  }`.toLowerCase();
  const words = latestUser
    .toLowerCase()
    .split(/[^a-z0-9_#-]+/)
    .filter((word) => word.length >= 4);
  return words.some((word) => haystack.includes(word));
}

function stringifyForMatch(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, TOOL_RESULT_MATCH_CHAR_LIMIT);
  } catch {
    return String(value).slice(0, TOOL_RESULT_MATCH_CHAR_LIMIT);
  }
}

function compactValue(value: unknown): unknown {
  if (value == null) return value;
  const text = stringifyForMatch(value);
  if (text.length <= TOOL_RESULT_VALUE_CHAR_LIMIT) return value;
  return { summary: truncate(text, TOOL_RESULT_VALUE_CHAR_LIMIT) };
}

function truncate(value: string | undefined, limit: number): string | undefined {
  if (value == null) return undefined;
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.ceil(text.length / 4);
}

function estimateContextTokens(
  context: Record<string, unknown>,
): ChatTurnTelemetry['tokens']['estimatedInput'] {
  const contextSections = {
    priorMessages: estimateTokens(context.priorMessages),
    availableTools: estimateTokens(context.availableTools),
    toolResults: estimateTokens(context.toolResults),
    recentEvents: estimateTokens(context.recentEvents),
    issueContext: estimateTokens(context.issueContext),
    governanceDigest: estimateTokens(context.governanceDigest),
    conversationSummary: estimateTokens(context.conversationSummary),
  };
  return {
    total: Object.values(contextSections).reduce((sum, value) => sum + value, 0),
    contextSections,
  };
}

function emptyTelemetry(): ChatTurnTelemetry {
  return {
    durationMs: {
      total: 0,
      contextBuild: 0,
      modelInvocation: 0,
      postModelParsing: 0,
      toolExecution: 0,
    },
    tokens: {
      actualInput: null,
      actualOutput: null,
      estimatedInput: {
        total: 0,
        contextSections: {
          priorMessages: 0,
          availableTools: 0,
          toolResults: 0,
          recentEvents: 0,
          issueContext: 0,
          governanceDigest: 0,
          conversationSummary: 0,
        },
      },
    },
    context: {
      priorMessagesSent: 0,
      priorMessagesSummarized: 0,
      availableToolsSent: 0,
      toolResultsSent: 0,
      recentEventsSent: 0,
      governanceDigestIncluded: false,
    },
  };
}

function elapsedSince(start: number): number {
  return Math.max(0, Date.now() - start);
}

function readActualTokens(
  runId: string,
): Pick<ChatTurnTelemetry['tokens'], 'actualInput' | 'actualOutput'> {
  try {
    const completed = eventStore.replay({ runId, kind: 'agent.run-completed', limit: 1 })[0];
    const payload = completed?.payload as {
      cost?: { inputTokens?: unknown; outputTokens?: unknown };
    };
    return {
      actualInput: typeof payload?.cost?.inputTokens === 'number' ? payload.cost.inputTokens : null,
      actualOutput:
        typeof payload?.cost?.outputTokens === 'number' ? payload.cost.outputTokens : null,
    };
  } catch {
    return { actualInput: null, actualOutput: null };
  }
}

/**
 * Run one turn. Returns `{reply: null}` when the run fails so the caller can
 * fall back to a friendly error in the chat UI without blowing up.
 */
export async function runChatOrchestratorTurn(input: ChatTurnInput): Promise<ChatTurnOutput> {
  const { conversation, runId } = input;
  const totalStarted = Date.now();
  const contextStarted = Date.now();
  const built = buildContext(input);
  const context = built.context;
  const telemetry: ChatTurnTelemetry = {
    ...emptyTelemetry(),
    ...built.telemetry,
    durationMs: {
      ...emptyTelemetry().durationMs,
      contextBuild: elapsedSince(contextStarted),
    },
  };

  // Honour the user-picked runtime stored on the conversation. We map
  // claude→sonnet-claude and codex→sonnet-codex so the agent-runtime
  // dispatcher (`selectRuntime`) picks the right CLI via `providerOf()`.
  // This also overrides any project-level rolesModels entry that would
  // otherwise pin auditor to opus (and bust chat's $0.4 budget).
  const provider = conversation.runtime === 'codex' ? 'codex' : 'claude';
  const modelOverride = defaultModelForTierAndProvider('sonnet', provider);

  emitThinking(conversation, runId, 'skill-invoked');

  // Captured the moment `selectPersona()` resolves inside `invokeSkill`, so we
  // can still attribute persona stats on a post-spawn throw (the resolved
  // result is never returned in that path).
  let selectedPersona: { personaId: string; role: string } | null = null;

  // Telemetry write — never let a SQLite hiccup turn a successful chat reply
  // into a user-visible failure. Persona attribution is best-effort.
  const tryAccumulate = (outcome: 'success' | 'failure') => {
    if (selectedPersona == null) return;
    try {
      accumulatePersonaStats({
        personaName: selectedPersona.personaId,
        role: selectedPersona.role,
        outcome,
      });
    } catch (statsErr) {
      logger.warn('chat orchestrator: persona stats write failed', {
        runId,
        err: String(statsErr),
      });
    }
  };

  try {
    const modelStarted = Date.now();
    const result = await invokeSkill({
      skillName: 'hub-chat',
      projectId: conversation.projectId ?? 'goose-hub-self',
      runId,
      context,
      overrides: {
        modelOverride,
        onPersonaSelected: (info) => {
          selectedPersona = info;
        },
      },
    });
    telemetry.durationMs.modelInvocation = elapsedSince(modelStarted);
    emitThinking(conversation, runId, 'structured-output-received');
    const parsingStarted = Date.now();
    const parsed = HubChatOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      telemetry.durationMs.postModelParsing = elapsedSince(parsingStarted);
      telemetry.durationMs.total = elapsedSince(totalStarted);
      Object.assign(telemetry.tokens, readActualTokens(runId));
      logger.warn('hub-chat: output validation failed', {
        runId,
        issues: parsed.error.issues,
      });
      // M20.14: count this turn as a failure for the picked persona so the
      // round-robin router can deprioritise personas that keep emitting
      // unparseable output.
      tryAccumulate('failure');
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
        telemetry,
      };
    }
    // Reconcile proposals: drop unknown tools and malformed JSON inputs before
    // handing off to the dispatcher.
    const validProposals = parsed.data.proposals
      .map(decodeProposalInput)
      .filter((p): p is HubChatProposal => p != null && manifestHas(p.toolName));
    telemetry.durationMs.postModelParsing = elapsedSince(parsingStarted);
    telemetry.durationMs.total = elapsedSince(totalStarted);
    Object.assign(telemetry.tokens, readActualTokens(runId));
    tryAccumulate('success');
    return {
      reply: {
        ...parsed.data,
        proposals: validProposals,
      },
      telemetry,
    };
  } catch (err) {
    telemetry.durationMs.total = elapsedSince(totalStarted);
    Object.assign(telemetry.tokens, readActualTokens(runId));
    logger.error('chat orchestrator invokeSkill threw', { runId, err: String(err) });
    // Clear the thinking indicator the UI is now showing. The dispatch
    // wrapper only emits `chat.run-failed` from its own try/catch — we
    // swallow the throw and return `{reply: null}`, so without this emit
    // the in-flight indicator would never go away for this conversation.
    eventStore.appendEvent({
      projectId: conversation.projectId ?? 'goose-hub-self',
      workItemId: CHAT_EVENT_WORK_ITEM_ID,
      kind: 'chat.run-failed',
      payload: { conversationId: conversation.id, runId, error: String(err), telemetry },
      runId,
    });
    // `selectedPersona` is non-null when the throw happened after
    // `selectPersona()` ran (OutputValidationError or any runtime throw).
    // Pre-spawn ContextValidationError throws before the callback fires,
    // so we skip in that case — there's no persona to penalise.
    tryAccumulate('failure');
    return { reply: null, telemetry };
  }
}

function decodeProposalInput(proposal: HubChatWireProposal): HubChatProposal | null {
  try {
    const input = JSON.parse(proposal.input) as unknown;
    if (input == null || typeof input !== 'object' || Array.isArray(input)) return null;
    return { ...proposal, input: input as Record<string, unknown> };
  } catch {
    return null;
  }
}

function manifestHas(name: string): boolean {
  return listToolManifests().some((t) => t.name === name);
}

type ThinkingCheckpoint = 'skill-invoked' | 'structured-output-received';

function emitThinking(conversation: Conversation, runId: string, checkpoint: ThinkingCheckpoint) {
  eventStore.appendEvent({
    projectId: conversation.projectId ?? 'goose-hub-self',
    workItemId: CHAT_EVENT_WORK_ITEM_ID,
    kind: 'chat.agent-thinking',
    payload: { conversationId: conversation.id, runId, checkpoint },
    runId,
  });
}
