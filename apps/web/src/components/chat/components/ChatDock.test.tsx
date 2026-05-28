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
import { ChatDock } from './ChatDock';

const { listConversations, fetchConversation, fetchToolManifest, useChatEvents } = vi.hoisted(
  () => ({
    listConversations: vi.fn(),
    fetchConversation: vi.fn(),
    fetchToolManifest: vi.fn(),
    useChatEvents: vi.fn(() => []),
  }),
);

vi.mock('@/lib/api/chat', () => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchConversation,
  fetchToolManifest,
  listConversations,
  postMessage: vi.fn(),
  resolveInvocation: vi.fn(),
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

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
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
  useChatEvents.mockReset();
  useChatEvents.mockReturnValue([]);
  fetchToolManifest.mockResolvedValue([] satisfies ChatToolManifestDto[]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ChatDock', () => {
  it('reopens on the conversation list after the launcher closes an open thread', async () => {
    const existingConversation = conversation();
    listConversations.mockResolvedValue([existingConversation]);
    fetchConversation.mockResolvedValue({
      conversation: existingConversation,
      messages: [message()],
      invocations: [] satisfies ChatToolInvocationDto[],
    });

    render(
      <Providers>
        <ChatDock />
      </Providers>,
    );

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('chat-conversation-select')[0]);

    await waitFor(() => {
      expect(screen.getByTestId('chat-thread-proxy').textContent).toBe('thread:1');
    });
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe(existingConversation.id);

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();
    });
    expect(screen.getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });
    expect(screen.queryByTestId('chat-thread-proxy')).toBeNull();
  });
});
