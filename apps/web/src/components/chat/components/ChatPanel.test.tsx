/** @vitest-environment jsdom */
import { fetchConversation, fetchToolManifest, listConversations } from '@/lib/api/chat';
import type { ChatConversationDto, ChatMessageDto, ChatToolInvocationDto } from '@/lib/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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
  useChatEvents: () => [],
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const mockedListConversations = vi.mocked(listConversations);
const mockedFetchConversation = vi.mocked(fetchConversation);
const mockedFetchToolManifest = vi.mocked(fetchToolManifest);

const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';

function conversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Saved thread',
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
    role: 'agent',
    content: 'Agent hello',
    runId: 'run-1',
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function invocation(overrides: Partial<ChatToolInvocationDto> = {}): ChatToolInvocationDto {
  return {
    id: 'inv-1',
    conversationId: 'conv-1',
    messageId: null,
    toolName: 'open_url',
    input: {},
    mutating: false,
    status: 'completed',
    result: { path: '/issues/1' },
    errorMessage: null,
    runId: null,
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
}

function renderPanel(open: boolean, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <Providers>
        <ChatPanel open={open} onClose={onClose} />
      </Providers>,
    ),
  };
}

describe('ChatPanel', () => {
  it('clears the stored active conversation and reopens on the list after header close', async () => {
    const savedConversation = conversation();
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, savedConversation.id);
    mockedFetchToolManifest.mockResolvedValue([]);
    mockedListConversations.mockResolvedValue([savedConversation]);
    mockedFetchConversation.mockResolvedValue({
      conversation: savedConversation,
      messages: [message()],
      invocations: [],
    });

    const { onClose, rerender } = renderPanel(true);

    await waitFor(() => {
      expect(screen.getByText('Agent hello')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Close chat'));

    expect(onClose).toHaveBeenCalledWith('header-close');
    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBeNull();

    rerender(
      <Providers>
        <ChatPanel open={false} onClose={onClose} />
      </Providers>,
    );
    rerender(
      <Providers>
        <ChatPanel open onClose={onClose} />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });
    expect(screen.queryByText('Agent hello')).toBeNull();
    expect(mockedFetchConversation).toHaveBeenCalledTimes(1);
  });

  it('uses the navigate close reason without clearing the stored active conversation', async () => {
    const savedConversation = conversation();
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, savedConversation.id);
    mockedFetchToolManifest.mockResolvedValue([]);
    mockedListConversations.mockResolvedValue([savedConversation]);
    mockedFetchConversation.mockResolvedValue({
      conversation: savedConversation,
      messages: [message()],
      invocations: [invocation()],
    });

    const { onClose } = renderPanel(true);

    const navigateButton = await screen.findByRole('button', { name: 'Open /issues/1' });
    fireEvent.click(navigateButton);

    expect(onClose).toHaveBeenCalledWith('navigate');
    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBe(savedConversation.id);
  });
});
