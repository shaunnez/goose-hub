/** @vitest-environment jsdom */
import type { ChatConversationDto, ChatMessageDto } from '@/lib/types';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

vi.mock('@/lib/api/chat', () => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchConversation: vi.fn(),
  fetchToolManifest: vi.fn(),
  listConversations: vi.fn(),
  postMessage: vi.fn(),
  resolveInvocation: vi.fn(),
}));

vi.mock('../lib/useChatEvents', () => ({
  useChatEvents: vi.fn(() => []),
}));

vi.mock('./ConversationList', () => ({
  ConversationList: ({
    conversations,
    onSelect,
  }: {
    conversations: ChatConversationDto[];
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="chat-conversation-list">
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          data-testid="chat-conversation-select"
          onClick={() => onSelect(conversation.id)}
          type="button"
        >
          {conversation.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('./ChatThread', () => ({
  ChatThread: ({ messages }: { messages: ChatMessageDto[] }) => (
    <div data-testid="chat-thread">
      {messages.map((message) => (
        <div key={message.id}>{message.content}</div>
      ))}
    </div>
  ),
}));

vi.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';
const mountedRoots: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    mounted.unmount();
  }
  localStorage.clear();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

function makeConversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Alpha thread',
    runtime: 'codex',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 1,
    conversationId: 'conv-1',
    role: 'agent',
    content: 'Restored thread content',
    runId: null,
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function renderIntoBody(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(element);
  });

  return {
    rerender(next: ReactNode) {
      flushSync(() => {
        root.render(next);
      });
    },
    unmount() {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function renderPanel(open: boolean, restoreLastConversationOnOpen?: boolean) {
  return renderIntoBody(
    <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
      <ChatPanel
        open={open}
        onClose={() => {}}
        restoreLastConversationOnOpen={restoreLastConversationOnOpen}
      />
    </MemoryRouter>,
  );
}

function click(element: Element | null) {
  expect(element).not.toBeNull();
  if (element == null) {
    throw new Error('Expected clickable element');
  }
  flushSync(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function queryByText(text: string) {
  return Array.from(document.body.querySelectorAll('*')).find((node) =>
    node.textContent?.includes(text),
  );
}

async function waitFor(assertion: () => void, timeoutMs = 1000) {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ChatPanel', () => {
  it('restores the persisted conversation by default when reopening', async () => {
    const { fetchConversation, fetchToolManifest, listConversations } = await import(
      '@/lib/api/chat'
    );
    const conversation = makeConversation();
    vi.mocked(fetchToolManifest).mockResolvedValue([]);
    vi.mocked(listConversations).mockResolvedValue([conversation]);
    vi.mocked(fetchConversation).mockResolvedValue({
      conversation,
      messages: [makeMessage()],
      invocations: [],
    });
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversation.id);

    const mounted = renderPanel(true);
    mountedRoots.push(mounted);

    await waitFor(() => expect(queryByText('Restored thread content')).toBeTruthy());
    expect(fetchConversation).toHaveBeenCalledWith(conversation.id);
  });

  it('resets to the list view on reopen when restoreLastConversationOnOpen is false', async () => {
    const { fetchConversation, fetchToolManifest, listConversations } = await import(
      '@/lib/api/chat'
    );
    const conversation = makeConversation();
    const threadMessage = makeMessage({ content: 'Conversation-only content' });
    vi.mocked(fetchToolManifest).mockResolvedValue([]);
    vi.mocked(listConversations).mockResolvedValue([conversation]);
    vi.mocked(fetchConversation).mockResolvedValue({
      conversation,
      messages: [threadMessage],
      invocations: [],
    });

    const mounted = renderPanel(false, false);
    mountedRoots.push(mounted);

    mounted.rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(document.querySelector('[data-testid="chat-conversation-select"]')).toBeTruthy(),
    );
    click(document.querySelector('[data-testid="chat-conversation-select"]'));

    await waitFor(() => expect(queryByText('Conversation-only content')).toBeTruthy());
    expect(fetchConversation).toHaveBeenCalledTimes(1);

    mounted.rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open={false} onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    mounted.rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(document.querySelector('[data-testid="chat-conversation-select"]')).toBeTruthy(),
    );
    expect(queryByText('Conversation-only content')).toBeUndefined();
    expect(fetchConversation).toHaveBeenCalledTimes(1);
  });

  it('clears the previous thread before conversations finish loading when reopen does not restore', async () => {
    const { fetchConversation, fetchToolManifest, listConversations } = await import(
      '@/lib/api/chat'
    );
    const conversation = makeConversation();
    const threadMessage = makeMessage({ content: 'Thread should clear immediately' });
    const reopenList = deferredPromise<ChatConversationDto[]>();
    vi.mocked(fetchToolManifest).mockResolvedValue([]);
    vi.mocked(listConversations)
      .mockResolvedValueOnce([conversation])
      .mockReturnValueOnce(reopenList.promise);
    vi.mocked(fetchConversation).mockResolvedValue({
      conversation,
      messages: [threadMessage],
      invocations: [],
    });

    const mounted = renderPanel(false, false);
    mountedRoots.push(mounted);

    mounted.rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(document.querySelector('[data-testid="chat-conversation-list"]')).toBeTruthy(),
    );
    click(document.querySelector('[data-testid="chat-conversation-select"]'));
    await waitFor(() => expect(queryByText('Thread should clear immediately')).toBeTruthy());

    mounted.rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open={false} onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );
    mounted.rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    expect(document.querySelector('[data-testid="chat-conversation-list"]')).toBeTruthy();
    expect(queryByText('Thread should clear immediately')).toBeUndefined();

    reopenList.resolve([conversation]);
    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
  });
});
