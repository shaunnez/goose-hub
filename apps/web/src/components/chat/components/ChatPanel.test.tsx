/** @vitest-environment jsdom */
import type {
  ChatConversationDto,
  ChatMessageDto,
  ChatToolInvocationDto,
  ChatToolManifestDto,
} from '@/lib/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

const {
  listConversations,
  fetchConversation,
  fetchToolManifest,
  createConversation,
  deleteConversation,
  postMessage,
  resolveInvocation,
  useChatEvents,
} = vi.hoisted(() => ({
  listConversations: vi.fn(),
  fetchConversation: vi.fn(),
  fetchToolManifest: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  postMessage: vi.fn(),
  resolveInvocation: vi.fn(),
  useChatEvents: vi.fn(() => []),
}));

vi.mock('@/lib/api/chat', () => ({
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchToolManifest,
  listConversations,
  postMessage,
  resolveInvocation,
}));

vi.mock('../lib/useChatEvents', () => ({
  useChatEvents,
}));

vi.mock('./ChatInput', () => ({
  ChatInput: ({ disabled }: { disabled: boolean }) => (
    <div data-testid="chat-input-proxy" data-disabled={String(disabled)} />
  ),
}));

vi.mock('./ChatThread', () => ({
  ChatThread: ({ messages }: { messages: ChatMessageDto[] }) => (
    <div data-testid="chat-thread-proxy">thread:{messages.length}</div>
  ),
}));

vi.mock('./ConversationList', () => ({
  ConversationList: ({
    conversations,
    onSelect,
  }: {
    conversations: ChatConversationDto[];
    activeConversationId: string | null;
    busy: boolean;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onNew: () => void;
  }) => (
    <div data-testid="chat-conversation-list-proxy">
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          data-testid={`conversation-${conversation.id}`}
          onClick={() => onSelect(conversation.id)}
        >
          {conversation.title}
        </button>
      ))}
    </div>
  ),
}));

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
}

function renderPanel(launcherResetToken: number) {
  return render(
    <Providers>
      <ChatPanel open launcherResetToken={launcherResetToken} onClose={() => {}} />
    </Providers>,
  );
}

function conversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Conversation one',
    runtime: 'codex',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 1,
    conversationId: 'conv-1',
    role: 'user',
    content: 'hello',
    runId: null,
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  listConversations.mockReset();
  fetchConversation.mockReset();
  fetchToolManifest.mockReset();
  createConversation.mockReset();
  deleteConversation.mockReset();
  postMessage.mockReset();
  resolveInvocation.mockReset();
  useChatEvents.mockReset();
  useChatEvents.mockReturnValue([]);
  fetchToolManifest.mockResolvedValue([] satisfies ChatToolManifestDto[]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ChatPanel', () => {
  it('resets the active thread and clears localStorage when launcherResetToken increments', async () => {
    const existingConversation = conversation();
    localStorage.setItem('hub-chat-active-conversation-id', existingConversation.id);
    listConversations.mockResolvedValue([existingConversation]);
    fetchConversation.mockResolvedValue({
      conversation: existingConversation,
      messages: [message()],
      invocations: [] satisfies ChatToolInvocationDto[],
    });

    const view = renderPanel(0);

    await waitFor(() => {
      expect(screen.getByTestId('chat-thread-proxy').textContent).toBe('thread:1');
    });
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe(existingConversation.id);

    view.rerender(
      <Providers>
        <ChatPanel open launcherResetToken={1} onClose={() => {}} />
      </Providers>,
    );

    await waitFor(() => {
      expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();
    });
    expect(screen.getByTestId('chat-conversation-list-proxy')).toBeTruthy();
    expect(screen.queryByTestId('chat-thread-proxy')).toBeNull();
  });

  it('restores a selected conversation while the panel stays open', async () => {
    const existingConversation = conversation();
    listConversations.mockResolvedValue([existingConversation]);
    fetchConversation.mockResolvedValue({
      conversation: existingConversation,
      messages: [message()],
      invocations: [] satisfies ChatToolInvocationDto[],
    });

    renderPanel(0);

    await waitFor(() => {
      expect(screen.getByTestId(`conversation-${existingConversation.id}`)).toBeTruthy();
    });
    expect(screen.getByTestId('chat-conversation-list-proxy')).not.toBeNull();

    fireEvent.click(screen.getByTestId(`conversation-${existingConversation.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('chat-thread-proxy').textContent).toBe('thread:1');
    });
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe(existingConversation.id);
  });
});
