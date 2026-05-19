import { beforeEach, describe, expect, it, vi } from 'vitest';

const toolMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  openUrl: vi.fn(),
  transitionIssue: vi.fn(),
}));

vi.mock('#shared/chat-dispatch.js', () => ({
  newChatRunId: vi.fn(() => 'chat_test_run'),
  runChatTurn: vi.fn(async () => ({ agentMessage: null, invocations: [] })),
}));

vi.mock('./tools.js', () => ({
  CHAT_TOOL_IMPLEMENTATIONS: {
    list_projects: toolMocks.listProjects,
    open_url: toolMocks.openUrl,
    transition_issue: toolMocks.transitionIssue,
  },
  ToolExecutionError: class ToolExecutionError extends Error {},
}));

const mockCanonicalizeWorkItemId = vi.fn(async (_projectSlug: string, workItemId: string) =>
  workItemId.startsWith('github:') ? workItemId : `github:shaunnez/goose-hub#${workItemId}`,
);
vi.mock('#shared/work-item-snapshot.js', () => ({
  canonicalizeWorkItemId: (projectSlug: string, workItemId: string) =>
    mockCanonicalizeWorkItemId(projectSlug, workItemId),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { runChatTurn } from '#shared/chat-dispatch.js';
import { appendMessage, getToolInvocation, listMessages } from './repository.js';
import {
  deleteConversationService,
  fetchConversation,
  listConversationsService,
  persistAndMaybeRunProposal,
  postUserMessage,
  resolveProposal,
  startConversation,
} from './service.js';
import { __resetWatchRegistryForTests, getWatchRegistry } from './watch-singleton.js';

async function waitForRunChatTurnCalls(count: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (vi.mocked(runChatTurn).mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${count} chat turn calls`);
}

async function delayedChatTurn(): Promise<{ agentMessage: null; invocations: [] }> {
  await new Promise((resolve) => setTimeout(resolve, 25));
  return { agentMessage: null, invocations: [] };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForInvocationStatus(
  invocationId: string,
  status: NonNullable<ReturnType<typeof getToolInvocation>>['status'],
): Promise<NonNullable<ReturnType<typeof getToolInvocation>>> {
  for (let i = 0; i < 50; i++) {
    const invocation = getToolInvocation(invocationId);
    if (invocation?.status === status) return invocation;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${invocationId} to become ${status}`);
}

async function waitForMockCalls(
  mock: { mock: { calls: unknown[] } },
  count: number,
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (mock.mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${count} mock calls`);
}

describe('chat service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runChatTurn).mockResolvedValue({ agentMessage: null, invocations: [] });
    toolMocks.listProjects.mockResolvedValue({ projects: [] });
    toolMocks.openUrl.mockResolvedValue({ ok: true, path: '/projects/goose-hub-self/items/861' });
    toolMocks.transitionIssue.mockResolvedValue({ ok: true });
    mockCanonicalizeWorkItemId.mockImplementation(
      async (_projectSlug: string, workItemId: string) =>
        workItemId.startsWith('github:') ? workItemId : `github:shaunnez/goose-hub#${workItemId}`,
    );
  });

  it('rejects scope=project without a projectSlug', async () => {
    const result = await startConversation({ scope: 'project' });
    expect(result.ok).toBe(false);
  });

  it('rejects scope=item without a workItemId', async () => {
    const result = await startConversation({ scope: 'item', projectSlug: 'goose-hub-self' });
    expect(result.ok).toBe(false);
  });

  it('canonicalizes item-scoped conversations to the repo-qualified workItemId', async () => {
    const result = await startConversation({
      scope: 'item',
      projectSlug: 'goose-hub-self',
      workItemId: '827',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.conversation.workItemId).toBe('github:shaunnez/goose-hub#827');
    }
    expect(mockCanonicalizeWorkItemId).toHaveBeenCalledWith('goose-hub-self', '827');
  });

  it('emits item-scoped chat messages without issue timeline attribution', async () => {
    const projectSlug = `chat-events-${Date.now()}`;
    const start = await startConversation({
      scope: 'item',
      projectSlug,
      workItemId: '827',
    });
    if (!start.ok) throw new Error('expected ok');

    const result = await postUserMessage({
      conversationId: start.data.conversation.id,
      content: 'check this issue',
    });
    expect(result.ok).toBe(true);

    const userEvent = eventStore
      .replay({ projectId: projectSlug })
      .find((event) => event.kind === 'chat.user-message');
    expect(userEvent?.workItemId).toBeNull();
  });

  it('creates a conversation and round-trips through fetch', async () => {
    const start = await startConversation({
      scope: 'project',
      projectSlug: 'goose-hub-self',
    });
    if (!start.ok) throw new Error('expected ok');
    const id = start.data.conversation.id;

    const fetched = await fetchConversation(id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.data.conversation.id).toBe(id);
      expect(fetched.data.messages.length).toBe(0);
    }
  });

  it('posting a user message persists it and triggers the chat orchestrator', async () => {
    const start = await startConversation({ scope: 'global' });
    if (!start.ok) throw new Error('expected ok');

    const reply = await postUserMessage({
      conversationId: start.data.conversation.id,
      content: 'hello goose hub',
    });
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.data.user.role).toBe('user');
      expect(reply.data.user.content).toBe('hello goose hub');
      expect(reply.data.runId).toBe('chat_test_run');
    }
    await waitForRunChatTurnCalls(1);
    expect(runChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({ id: start.data.conversation.id }),
      'chat_test_run',
    );

    const after = await fetchConversation(start.data.conversation.id);
    if (after.ok) {
      expect(after.data.messages.length).toBe(1);
      expect(after.data.messages[0].content).toBe('hello goose hub');
    }
  });

  it('rejects a second in-flight turn for the same conversation', async () => {
    const start = await startConversation({ scope: 'global' });
    if (!start.ok) throw new Error('expected ok');
    const id = start.data.conversation.id;

    vi.mocked(runChatTurn).mockImplementationOnce(delayedChatTurn);

    const first = await postUserMessage({ conversationId: id, content: 'first' });
    const second = await postUserMessage({ conversationId: id, content: 'second' });

    expect(first.ok).toBe(true);

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.status).toBe(409);
      expect(second.error).toMatch(/in-flight/);
    }

    const during = await fetchConversation(id);
    expect(during.ok).toBe(true);
    if (during.ok) {
      expect(during.data.messages.map((m) => m.content)).toEqual(['first']);
    }

    await waitForRunChatTurnCalls(1);
  });

  it('allows concurrent turns for different conversations', async () => {
    const firstStart = await startConversation({ scope: 'global' });
    const secondStart = await startConversation({ scope: 'global' });
    if (!firstStart.ok || !secondStart.ok) throw new Error('expected ok');

    vi.mocked(runChatTurn)
      .mockImplementationOnce(delayedChatTurn)
      .mockImplementationOnce(delayedChatTurn);

    const first = postUserMessage({
      conversationId: firstStart.data.conversation.id,
      content: 'first',
    });
    const second = postUserMessage({
      conversationId: secondStart.data.conversation.id,
      content: 'second',
    });

    await waitForRunChatTurnCalls(2);

    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
  });

  it('deletes a conversation and clears its pending watches', async () => {
    __resetWatchRegistryForTests();
    const start = await startConversation({ scope: 'global' });
    if (!start.ok) throw new Error('expected ok');
    const id = start.data.conversation.id;

    getWatchRegistry().addRunWatch(id, 'run_owned');
    getWatchRegistry().addRunWatch('other_conversation', 'run_other');

    const result = await deleteConversationService(id);
    expect(result.ok).toBe(true);

    expect(getWatchRegistry().listForConversation(id)).toHaveLength(0);
    expect(getWatchRegistry().listForConversation('other_conversation')).toHaveLength(1);

    const fetched = await fetchConversation(id);
    expect(fetched.ok).toBe(false);

    __resetWatchRegistryForTests();
  });

  it('lists conversations filtered by scope', async () => {
    const g = await startConversation({ scope: 'global' });
    const p = await startConversation({ scope: 'project', projectSlug: 'goose-hub-self' });
    if (!g.ok || !p.ok) throw new Error('expected both ok');

    const projectList = await listConversationsService({
      scope: 'project',
      projectSlug: 'goose-hub-self',
    });
    if (projectList.ok) {
      expect(
        projectList.data.conversations.find((c) => c.id === p.data.conversation.id),
      ).toBeDefined();
      expect(
        projectList.data.conversations.find((c) => c.id === g.data.conversation.id),
      ).toBeUndefined();
    }
  });

  it('returns immediately for read-only proposals while execution continues', async () => {
    const delayed = deferred<{ projects: Array<{ slug: string }> }>();
    toolMocks.listProjects.mockReturnValueOnce(delayed.promise);
    const start = await startConversation({
      scope: 'project',
      projectSlug: `chat-readonly-${Date.now()}`,
    });
    if (!start.ok) throw new Error('expected ok');

    const invocation = await persistAndMaybeRunProposal(start.data.conversation, null, {
      toolName: 'list_projects',
      input: {},
      rationale: 'check projects',
    });

    expect(invocation.status).toBe('running');
    expect(toolMocks.listProjects).not.toHaveBeenCalled();
    expect(getToolInvocation(invocation.id)?.status).toBe('running');

    await waitForMockCalls(toolMocks.listProjects, 1);
    delayed.resolve({ projects: [{ slug: 'goose-hub-self' }] });
    const completed = await waitForInvocationStatus(invocation.id, 'completed');
    expect(completed.result).toEqual({ projects: [{ slug: 'goose-hub-self' }] });
  });

  it('parks mutating proposals as proposed until approval', async () => {
    const start = await startConversation({
      scope: 'project',
      projectSlug: `chat-mutating-${Date.now()}`,
    });
    if (!start.ok) throw new Error('expected ok');

    const invocation = await persistAndMaybeRunProposal(start.data.conversation, null, {
      toolName: 'transition_issue',
      input: { projectSlug: 'goose-hub-self', issueId: '1', toState: 'factory:needs-qa' },
      rationale: 'move it',
    });

    expect(invocation.status).toBe('proposed');
    expect(getToolInvocation(invocation.id)?.status).toBe('proposed');
    expect(toolMocks.transitionIssue).not.toHaveBeenCalled();
  });

  it('carries proposal rationale into open_url approval input', async () => {
    const start = await startConversation({
      scope: 'project',
      projectSlug: `chat-open-url-${Date.now()}`,
    });
    if (!start.ok) throw new Error('expected ok');

    const invocation = await persistAndMaybeRunProposal(start.data.conversation, null, {
      toolName: 'open_url',
      input: { path: '/projects/goose-hub-self/items/861' },
      rationale: 'If you approve, this will navigate Goose Hub to work item #861.',
    });

    const resolved = await resolveProposal({
      conversationId: start.data.conversation.id,
      invocationId: invocation.id,
      decision: 'approve',
    });

    expect(resolved.ok).toBe(true);
    expect(getToolInvocation(invocation.id)?.status).toBe('completed');
    expect(toolMocks.openUrl).toHaveBeenCalledWith(
      {
        path: '/projects/goose-hub-self/items/861',
        rationale: 'If you approve, this will navigate Goose Hub to work item #861.',
      },
      expect.objectContaining({
        conversationId: start.data.conversation.id,
        projectId: start.data.conversation.projectId,
        invocationId: invocation.id,
      }),
    );
  });

  it('records read-only failures without removing the agent reply', async () => {
    const delayed = deferred<never>();
    toolMocks.listProjects.mockReturnValueOnce(delayed.promise);
    const start = await startConversation({
      scope: 'project',
      projectSlug: `chat-failure-${Date.now()}`,
    });
    if (!start.ok) throw new Error('expected ok');
    const agent = appendMessage({
      conversationId: start.data.conversation.id,
      role: 'agent',
      content: 'I will check.',
    });

    const invocation = await persistAndMaybeRunProposal(start.data.conversation, agent.id, {
      toolName: 'list_projects',
      input: {},
      rationale: 'check projects',
    });
    await waitForMockCalls(toolMocks.listProjects, 1);
    delayed.reject(new Error('tool exploded'));

    const failed = await waitForInvocationStatus(invocation.id, 'failed');
    expect(failed.errorMessage).toBe('Error: tool exploded');
    expect(listMessages(start.data.conversation.id).map((m) => m.content)).toContain(
      'I will check.',
    );
  });
});
