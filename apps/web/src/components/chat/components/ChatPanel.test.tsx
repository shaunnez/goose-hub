/** @vitest-environment jsdom */
import type { ChatConversationDto, ChatMessageDto } from '@/lib/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

const chatApiMocks = vi.hoisted(() => ({
  listConversations: vi.fn(),
  fetchConversation: vi.fn(),
  fetchToolManifest: vi.fn(),
}));

vi.mock('@/lib/api/chat', () => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchConversation: chatApiMocks.fetchConversation,
  fetchToolManifest: chatApiMocks.fetchToolManifest,
  listConversations: chatApiMocks.listConversations,
  postMessage: vi.fn(),
  resolveInvocation: vi.fn(),
}));

vi.mock('../lib/useChatEvents', () => ({
  useChatEvents: () => [],
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  localStorage.clear();
  chatApiMocks.fetchToolManifest.mockResolvedValue([]);
});

function renderPanel(open: boolean, onClose = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ChatPanel open={open} onClose={onClose} />
    </MemoryRouter>,
  );
}

function makeConversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Release work',
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
    content: 'Previously opened thread',
    runId: null,
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

describe('ChatPanel', () => {
  it('renders the conversation list on open when no active conversation is stored', async () => {
    chatApiMocks.listConversations.mockResolvedValue([makeConversation()]);

    renderPanel(true);

    expect(await screen.findByTestId('chat-conversation-list')).toBeTruthy();
    expect(chatApiMocks.fetchConversation).not.toHaveBeenCalled();
  });

  it('resets to the list view after close and does not restore the last thread on reopen', async () => {
    const conversation = makeConversation();
    const message = makeMessage();

    chatApiMocks.listConversations.mockResolvedValue([conversation]);
    chatApiMocks.fetchConversation.mockResolvedValue({
      conversation,
      messages: [message],
      invocations: [],
    });

    const onClose = vi.fn();
    const rendered = renderPanel(true, onClose);

    expect(await screen.findByTestId('chat-conversation-list')).toBeTruthy();

    fireEvent.click(screen.getByTestId('chat-conversation-select'));

    expect(await screen.findByText('Previously opened thread')).toBeTruthy();
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');

    rendered.rerender(
      <MemoryRouter initialEntries={['/']}>
        <ChatPanel open={false} onClose={onClose} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();
    });

    rendered.rerender(
      <MemoryRouter initialEntries={['/']}>
        <ChatPanel open={true} onClose={onClose} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('chat-conversation-list')).toBeTruthy();
    expect(screen.queryByText('Previously opened thread')).toBeNull();
    expect(chatApiMocks.fetchConversation).toHaveBeenCalledTimes(1);
  });
});
