/** @vitest-environment jsdom */
import type { ChatConversationDto, ChatMessageDto } from '@/lib/types';
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
  vi.clearAllMocks();
  listConversations.mockResolvedValue([conversation()]);
  fetchConversation.mockResolvedValue({
    conversation: conversation(),
    messages: [message()],
    invocations: [],
  });
  fetchToolManifest.mockResolvedValue([]);
});

describe('ChatDock', () => {
  it('resets the active thread when closed and reopened from the launcher', async () => {
    renderDock();

    await openConversationFromLauncher();
    expect(screen.getByText('Previously opened thread')).toBeTruthy();
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });
    expect(screen.queryByText('Previously opened thread')).toBeNull();
  });

  it('applies the same reset path from the panel header close button', async () => {
    renderDock();

    await openConversationFromLauncher();
    expect(screen.getByText('Previously opened thread')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close chat'));
    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });
    expect(screen.queryByText('Previously opened thread')).toBeNull();
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();
  });
});

function renderDock() {
  return render(
    <MemoryRouter>
      <ChatDock />
    </MemoryRouter>,
  );
}

async function openConversationFromLauncher() {
  fireEvent.click(screen.getByTestId('chat-launcher'));

  await waitFor(() => {
    expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
  });

  fireEvent.click(screen.getByTestId('chat-conversation-select'));

  await waitFor(() => {
    expect(screen.getByText('Previously opened thread')).toBeTruthy();
  });
}

function conversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Existing conversation',
    runtime: 'codex',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function message(): ChatMessageDto {
  return {
    id: 1,
    conversationId: 'conv-1',
    role: 'agent',
    content: 'Previously opened thread',
    runId: 'run-1',
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
  };
}
