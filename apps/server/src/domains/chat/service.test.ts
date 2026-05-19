import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#shared/chat-dispatch.js', () => ({
  newChatRunId: vi.fn(() => 'chat_test_run'),
  runChatTurn: vi.fn(async () => ({ agentMessage: null, invocations: [] })),
}));

const mockCanonicalizeWorkItemId = vi.fn(async (_projectSlug: string, workItemId: string) =>
  workItemId.startsWith('github:') ? workItemId : `github:shaunnez/goose-hub#${workItemId}`,
);
vi.mock('#shared/work-item-snapshot.js', () => ({
  canonicalizeWorkItemId: (projectSlug: string, workItemId: string) =>
    mockCanonicalizeWorkItemId(projectSlug, workItemId),
}));

import { runChatTurn } from '#shared/chat-dispatch.js';
import {
  deleteConversationService,
  fetchConversation,
  listConversationsService,
  postUserMessage,
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

describe('chat service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runChatTurn).mockResolvedValue({ agentMessage: null, invocations: [] });
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
});
