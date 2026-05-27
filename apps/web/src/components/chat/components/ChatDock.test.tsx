/** @vitest-environment jsdom */
import type { ChatConversationDto, ChatMessageDto, ChatToolManifestDto } from '@/lib/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

const listConversations = vi.fn();
const fetchConversation = vi.fn();
const fetchToolManifest = vi.fn();

vi.mock('@/lib/api/chat', () => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchConversation: (...args: unknown[]) => fetchConversation(...args),
  fetchToolManifest: (...args: unknown[]) => fetchToolManifest(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  postMessage: vi.fn(),
  resolveInvocation: vi.fn(),
}));

vi.mock('../lib/useChatEvents', () => ({
  useChatEvents: () => [],
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  listConversations.mockReset();
  fetchConversation.mockReset();
  fetchToolManifest.mockReset();
  fetchToolManifest.mockResolvedValue([]);
});

function conversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Existing chat',
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
    content: 'Thread message',
    runId: null,
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

describe('ChatDock', () => {
  it('resets the active conversation when the launcher closes the dock', async () => {
    const existingConversation = conversation();
    listConversations.mockResolvedValue([existingConversation]);
    fetchConversation.mockResolvedValue({
      conversation: existingConversation,
      messages: [message()],
      invocations: [],
    });

    render(
      <MemoryRouter>
        <ChatDock />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('chat-launcher'));

    expect(await screen.findByText('Existing chat')).toBeTruthy();

    fireEvent.click(screen.getByTestId('chat-conversation-select'));

    expect(await screen.findByText('Thread message')).toBeTruthy();
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });
  });
});
