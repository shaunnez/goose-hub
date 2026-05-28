import { describe, expect, it, vi } from 'vitest';

// Skill invocation is mocked at the agent-runtime layer because spawning a
// real subprocess in tests is out of scope for the slice contract.
vi.mock('@goose-hub/core/agent-runtime/invoke-skill.js', () => ({
  invokeSkill: vi.fn(),
}));

// The event store is heavyweight; we only need replay() to return [].
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    replay: vi.fn(() => []),
    appendEvent: vi.fn(),
  },
}));

vi.mock('@goose-hub/core/conversations/repository.js', () => ({
  listToolInvocations: vi.fn(() => []),
}));

// Persona-stats writes touch SQLite; mock to a spy so we can assert against
// the calls without needing a DB in this slice test.
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: vi.fn(),
}));

import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { listToolInvocations } from '@goose-hub/core/conversations/repository.js';
import type { Conversation } from '@goose-hub/core/conversations/types.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { runChatOrchestratorTurn } from './workflow.js';

const baseInvokeResult = {
  personaId: 'auditor-1',
  role: 'auditor',
  decisionSummaries: [],
  events: [],
};

type InvokeArgs = Parameters<typeof invokeSkill>[0];

/**
 * Mirror the real invokeSkill contract: fire `onPersonaSelected` before the
 * promise settles so the orchestrator can capture persona attribution and
 * write `persona_stats` even on a throw. The returned value/throw is chosen
 * by the caller.
 */
function mockInvokeOnce(
  outcome: { resolve: typeof baseInvokeResult & { output: unknown } } | { reject: Error },
  selected: { personaId: string; role: string } = baseInvokeResult,
) {
  vi.mocked(invokeSkill).mockImplementationOnce(async (input: InvokeArgs) => {
    input.overrides?.onPersonaSelected?.(selected);
    if ('reject' in outcome) throw outcome.reject;
    return outcome.resolve;
  });
}

const stubConversation: Conversation = {
  id: 'conv_test',
  scope: 'global',
  projectId: null,
  workItemId: null,
  title: '',
  runtime: 'claude',
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
};

describe('chat-orchestrator slice', () => {
  it('passes compact chat context into the hub-chat skill', async () => {
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'Compact reply.',
          proposals: [],
          done: false,
          decisionSummaries: [{ kind: 'PLAN', summary: 'Used compact context.' }],
        },
      },
    });
    vi.mocked(listToolInvocations).mockReturnValueOnce([
      {
        id: 'tool_old',
        conversationId: 'conv_test',
        messageId: 1,
        toolName: 'recent_events',
        input: {},
        mutating: false,
        status: 'completed',
        result: { message: 'older irrelevant output '.repeat(200) },
        errorMessage: null,
        runId: null,
        createdAt: '2026-05-18T00:00:00Z',
        updatedAt: '2026-05-18T00:00:00Z',
      },
      {
        id: 'tool_recent',
        conversationId: 'conv_test',
        messageId: 2,
        toolName: 'get_issue',
        input: {},
        mutating: false,
        status: 'completed',
        result: { issue: 812, title: 'Chat latency work' },
        errorMessage: null,
        runId: null,
        createdAt: '2026-05-18T00:01:00Z',
        updatedAt: '2026-05-18T00:01:00Z',
      },
    ]);
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'goose-hub-self',
        workItemId: null,
        kind: 'agent.run-completed',
        payload: { message: 'very long event payload '.repeat(100) },
        runId: 'other_run',
        personaId: null,
        createdAt: '2026-05-18T00:02:00Z',
      },
    ]);

    const history = Array.from({ length: 14 }, (_, index) => ({
      id: index + 1,
      conversationId: 'conv_test',
      role: index % 2 === 0 ? ('user' as const) : ('agent' as const),
      content: `message ${index + 1} ${
        index < 6 ? 'older commitment context' : 'recent turn context'
      }${index === 12 ? ' issue 812 chat latency' : ''}`,
      runId: null,
      meta: null,
      createdAt: `2026-05-18T00:${String(index).padStart(2, '0')}:00Z`,
    }));

    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history,
      runId: 'chat_test_compact_context',
    });

    const context = vi.mocked(invokeSkill).mock.calls.at(-1)?.[0].context as Record<
      string,
      unknown
    >;
    expect(context.priorMessages).toHaveLength(8);
    expect((context.priorMessages as Array<{ content: string }>)[0].content).toContain('message 7');
    expect(context.conversationSummary).toContain('message 1');
    expect(context.conversationSummary).toContain('message 6');
    expect(context.availableTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'list_projects',
          description: expect.any(String),
          mutating: false,
        }),
      ]),
    );
    expect(JSON.stringify(context.availableTools)).not.toContain('inputSchemaJson');
    expect(context.toolResults).toEqual([
      expect.objectContaining({ toolName: 'get_issue', status: 'completed' }),
      expect.objectContaining({ toolName: 'recent_events', status: 'completed' }),
    ]);
    expect(JSON.stringify(context.toolResults).length).toBeLessThan(2500);
    expect(JSON.stringify(context.recentEvents).length).toBeLessThan(700);
    expect((context.governanceDigest as string).length).toBeLessThan(1800);
  });

  it('injects backend-built issueContext for item-scoped chats', async () => {
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'QA passed.',
          proposals: [],
          done: false,
          decisionSummaries: [{ kind: 'READ', summary: 'Used issue context.' }],
        },
      },
    });
    const issueConversation: Conversation = {
      ...stubConversation,
      scope: 'item',
      projectId: 'goose-hub-self',
      workItemId: 'github:shaunnez/goose-hub#827',
    };
    await runChatOrchestratorTurn({
      conversation: issueConversation,
      history: [],
      runId: 'chat_test_issue_context',
      issueContext: {
        issue: { number: '827', state: 'factory:needs-review' },
        qa: { verdict: 'pass', testRun: { passed: 3770, failed: 0, skipped: 7, total: 3777 } },
      },
    });
    const context = vi.mocked(invokeSkill).mock.calls.at(-1)?.[0].context as Record<
      string,
      unknown
    >;
    const invokeInput = vi.mocked(invokeSkill).mock.calls.at(-1)?.[0];
    expect(invokeInput?.workItemId).toBeUndefined();
    expect(context.scope).toMatchObject({
      kind: 'item',
      projectSlug: 'goose-hub-self',
      workItemId: 'github:shaunnez/goose-hub#827',
    });
    expect(context.issueContext).toMatchObject({
      issue: { number: '827' },
      qa: { verdict: 'pass', testRun: { passed: 3770, failed: 0 } },
    });
  });

  it('returns a parsed reply when the skill output validates', async () => {
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'Hello there.',
          proposals: [],
          done: false,
          decisionSummaries: [{ kind: 'PLAN', summary: 'Replied to greeting.' }],
        },
      },
    });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [
        {
          id: 1,
          conversationId: 'conv_test',
          role: 'user',
          content: 'hi',
          runId: null,
          meta: null,
          createdAt: '2026-05-18T00:00:00Z',
        },
      ],
      runId: 'chat_test_run',
    });
    expect(result.reply).not.toBeNull();
    expect(result.reply?.say).toBe('Hello there.');
    expect(result.telemetry.durationMs.total).toBeGreaterThanOrEqual(0);
    expect(result.telemetry.durationMs.contextBuild).toBeGreaterThanOrEqual(0);
    expect(result.telemetry.durationMs.modelInvocation).toBeGreaterThanOrEqual(0);
    expect(result.telemetry.durationMs.postModelParsing).toBeGreaterThanOrEqual(0);
    expect(result.telemetry.tokens.estimatedInput.contextSections.priorMessages).toBeGreaterThan(0);
  });

  it('rejects output with unknown proposal tool names', async () => {
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'Doing things.',
          proposals: [
            { toolName: 'list_projects', input: '{}', rationale: 'see all projects' },
            { toolName: 'i_made_this_up', input: '{}', rationale: 'nope' },
          ],
          done: false,
          decisionSummaries: [{ kind: 'PLAN', summary: 'Proposing two tools.' }],
        },
      },
    });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_2',
    });
    expect(result.reply).toMatchObject({
      say: 'I tried to reply but the structured output failed validation. Please try again.',
      proposals: [],
      done: false,
    });
  });

  it('decodes proposal input JSON before returning dispatcher-ready proposals', async () => {
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'Checking the issue.',
          proposals: [
            {
              toolName: 'get_issue',
              input: '{"projectSlug":"goose-hub-self","issueNumber":918}',
              rationale: 'Checking issue 918.',
            },
          ],
          done: false,
          decisionSummaries: [{ kind: 'PLAN', summary: 'Proposing one tool.' }],
        },
      },
    });

    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_decode',
    });

    expect(result.reply?.proposals).toEqual([
      {
        toolName: 'get_issue',
        input: { projectSlug: 'goose-hub-self', issueNumber: 918 },
        rationale: 'Checking issue 918.',
      },
    ]);
  });

  it('returns a graceful error message on schema validation failure', async () => {
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: { not: 'the right shape' },
      },
    });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_3',
    });
    expect(result.reply?.say).toMatch(/structured output failed validation/i);
  });

  it('returns reply: null when the runtime throws', async () => {
    mockInvokeOnce({ reject: new Error('subprocess died') });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_4',
    });
    expect(result.reply).toBeNull();
  });

  it('emits chat.agent-thinking checkpoints around the skill invocation', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'sure.',
          proposals: [],
          done: false,
          decisionSummaries: [{ kind: 'PLAN', summary: 'ok.' }],
        },
      },
    });
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_thinking',
    });
    const thinkingCalls = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.kind === 'chat.agent-thinking');
    expect(thinkingCalls).toHaveLength(2);
    const checkpoints = thinkingCalls.map((e) => (e.payload as { checkpoint?: string }).checkpoint);
    expect(checkpoints).toEqual(['skill-invoked', 'structured-output-received']);
    for (const e of thinkingCalls) {
      const payload = e.payload as { conversationId?: string; runId?: string };
      expect(payload.conversationId).toBe('conv_test');
      expect(payload.runId).toBe('chat_test_thinking');
      expect(e.runId).toBe('chat_test_thinking');
      expect(e.workItemId).toBeNull();
    }
  });

  it('does not attach item-scoped chat lifecycle events to the issue timeline', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'issue-aware reply.',
          proposals: [],
          done: false,
          decisionSummaries: [{ kind: 'READ', summary: 'Used issue context.' }],
        },
      },
    });
    await runChatOrchestratorTurn({
      conversation: {
        ...stubConversation,
        scope: 'item',
        projectId: 'goose-hub-self',
        workItemId: 'github:shaunnez/goose-hub#827',
      },
      history: [],
      runId: 'chat_test_item_timeline_isolated',
    });

    const chatEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.map((c) => c[0])
      .filter((event) => event.kind.startsWith('chat.'));
    expect(chatEvents.length).toBeGreaterThan(0);
    expect(chatEvents.every((event) => event.workItemId == null)).toBe(true);
  });

  it('emits the skill-invoked thinking event even when the run later throws', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    mockInvokeOnce({ reject: new Error('boom') });
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_thinking_err',
    });
    const thinkingCalls = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.kind === 'chat.agent-thinking');
    // Only the pre-spawn checkpoint should fire on a thrown run.
    expect(thinkingCalls.map((e) => (e.payload as { checkpoint?: string }).checkpoint)).toEqual([
      'skill-invoked',
    ]);
  });

  it('writes a success persona-stats row when the run lands a parseable reply', async () => {
    vi.mocked(accumulatePersonaStats).mockClear();
    mockInvokeOnce(
      {
        resolve: {
          ...baseInvokeResult,
          personaId: 'auditor-2',
          role: 'auditor',
          output: {
            say: 'Sure.',
            proposals: [],
            done: false,
            decisionSummaries: [{ kind: 'PLAN', summary: 'replied.' }],
          },
        },
      },
      { personaId: 'auditor-2', role: 'auditor' },
    );
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_persona_success',
    });
    expect(accumulatePersonaStats).toHaveBeenCalledTimes(1);
    expect(accumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'auditor-2',
      role: 'auditor',
      outcome: 'success',
    });
  });

  it('writes a failure persona-stats row when the skill output fails validation', async () => {
    vi.mocked(accumulatePersonaStats).mockClear();
    mockInvokeOnce(
      {
        resolve: {
          ...baseInvokeResult,
          personaId: 'auditor-3',
          role: 'auditor',
          output: { not: 'the right shape' },
        },
      },
      { personaId: 'auditor-3', role: 'auditor' },
    );
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_persona_failure',
    });
    expect(accumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'auditor-3',
      role: 'auditor',
      outcome: 'failure',
    });
  });

  it('writes a failure persona-stats row when invokeSkill rejects after persona selection', async () => {
    vi.mocked(accumulatePersonaStats).mockClear();
    mockInvokeOnce(
      { reject: new Error('OutputValidationError: bad shape') },
      { personaId: 'auditor-4', role: 'auditor' },
    );
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_persona_reject',
    });
    expect(accumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'auditor-4',
      role: 'auditor',
      outcome: 'failure',
    });
  });

  it('still returns a parseable reply when persona-stats telemetry throws', async () => {
    vi.mocked(accumulatePersonaStats).mockImplementationOnce(() => {
      throw new Error('sqlite locked');
    });
    mockInvokeOnce({
      resolve: {
        ...baseInvokeResult,
        output: {
          say: 'Replied OK.',
          proposals: [],
          done: false,
          decisionSummaries: [{ kind: 'PLAN', summary: 'replied.' }],
        },
      },
    });
    const result = await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_telemetry_throws',
    });
    expect(result.reply?.say).toBe('Replied OK.');
  });

  it('emits chat.run-failed when the skill throws so the thinking indicator clears', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    mockInvokeOnce({ reject: new Error('subprocess died') });
    await runChatOrchestratorTurn({
      conversation: stubConversation,
      history: [],
      runId: 'chat_test_run_failed_event',
    });
    const failedCalls = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.kind === 'chat.run-failed');
    expect(failedCalls).toHaveLength(1);
    const payload = failedCalls[0].payload as {
      conversationId?: string;
      runId?: string;
      error?: string;
    };
    expect(payload.conversationId).toBe('conv_test');
    expect(payload.runId).toBe('chat_test_run_failed_event');
    expect(payload.error).toMatch(/subprocess died/);
  });
});
