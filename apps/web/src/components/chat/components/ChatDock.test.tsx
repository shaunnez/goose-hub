/** @vitest-environment jsdom */
import type { ChatConversationDto, ChatMessageDto, ChatToolInvocationDto } from '@/lib/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Root, createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

const {
  mockCreateConversation,
  mockDeleteConversation,
  mockFetchConversation,
  mockFetchToolManifest,
  mockListConversations,
  mockPostMessage,
  mockResolveInvocation,
} = vi.hoisted(() => ({
  mockCreateConversation: vi.fn(),
  mockDeleteConversation: vi.fn(),
  mockFetchConversation: vi.fn(),
  mockFetchToolManifest: vi.fn(),
  mockListConversations: vi.fn(),
  mockPostMessage: vi.fn(),
  mockResolveInvocation: vi.fn(),
}));

vi.mock('@/lib/api/chat', () => ({
  createConversation: mockCreateConversation,
  deleteConversation: mockDeleteConversation,
  fetchConversation: mockFetchConversation,
  fetchToolManifest: mockFetchToolManifest,
  listConversations: mockListConversations,
  postMessage: mockPostMessage,
  resolveInvocation: mockResolveInvocation,
}));

let root: Root | null = null;

afterEach(() => {
  if (root != null) {
    act(() => {
      root.unmount();
      root = null;
    });
  }
  document.body.innerHTML = '';
  localStorage.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchToolManifest.mockResolvedValue([]);
  mockListConversations.mockResolvedValue([conversation()]);
  mockFetchConversation.mockResolvedValue(fullConversation());
});

function conversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Support thread',
    runtime: 'codex',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function fullConversation(
  overrides: {
    conversation?: Partial<ChatConversationDto>;
    messages?: ChatMessageDto[];
    invocations?: ChatToolInvocationDto[];
  } = {},
) {
  return {
    conversation: conversation(overrides.conversation),
    messages: overrides.messages ?? [message()],
    invocations: overrides.invocations ?? [],
  };
}

function message(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 1,
    conversationId: 'conv-1',
    role: 'agent',
    content: 'Existing thread reply',
    runId: 'run-1',
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function renderChatDock() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatDock />
      </MemoryRouter>,
    );
  });
  return container;
}

describe('ChatDock', () => {
  it('loads the selected conversation into thread view', async () => {
    const user = userEvent.setup();
    renderChatDock();

    await user.click(screen.getByTestId('chat-launcher'));
    await user.click(await screen.findByTestId('chat-conversation-select'));

    expect(await screen.findByText('Existing thread reply')).toBeTruthy();
    expect(screen.getByTestId('chat-input')).toBeTruthy();
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');
  });

  it('resets to list view after launcher close and reopen', async () => {
    const user = userEvent.setup();
    renderChatDock();

    await user.click(screen.getByTestId('chat-launcher'));
    await user.click(await screen.findByTestId('chat-conversation-select'));
    expect(await screen.findByText('Existing thread reply')).toBeTruthy();

    await user.click(screen.getByTestId('chat-launcher'));
    await waitFor(() => {
      expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();
    });

    await user.click(screen.getByTestId('chat-launcher'));

    expect(await screen.findByTestId('chat-conversation-list')).toBeTruthy();
    expect(screen.queryByText('Existing thread reply')).toBeNull();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });
});
