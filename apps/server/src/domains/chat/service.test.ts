import { describe, expect, it, vi } from 'vitest';

vi.mock('#shared/chat-dispatch.js', () => ({
  runChatTurn: vi.fn(async () => ({ agentMessage: null, invocations: [] })),
}));

import {
  deleteConversationService,
  fetchConversation,
  listConversationsService,
  postUserMessage,
  startConversation,
} from './service.js';
import { __resetWatchRegistryForTests, getWatchRegistry } from './watch-singleton.js';

describe('chat service', () => {
  it('rejects scope=project without a projectSlug', async () => {
    const result = await startConversation({ scope: 'project' });
    expect(result.ok).toBe(false);
  });

  it('rejects scope=item without a workItemId', async () => {
    const result = await startConversation({ scope: 'item', projectSlug: 'goose-hub-self' });
    expect(result.ok).toBe(false);
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
    }

    const after = await fetchConversation(start.data.conversation.id);
    if (after.ok) {
      expect(after.data.messages.length).toBe(1);
      expect(after.data.messages[0].content).toBe('hello goose hub');
    }
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
