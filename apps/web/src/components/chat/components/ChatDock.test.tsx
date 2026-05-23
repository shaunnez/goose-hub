/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

const chatApi = vi.hoisted(() => ({
  listConversations: vi.fn(),
  fetchConversation: vi.fn(),
  fetchToolManifest: vi.fn(),
}));

vi.mock('@/lib/api/chat', () => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchConversation: chatApi.fetchConversation,
  fetchToolManifest: chatApi.fetchToolManifest,
  listConversations: chatApi.listConversations,
  postMessage: vi.fn(),
  resolveInvocation: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  chatApi.fetchToolManifest.mockResolvedValue([]);
});

afterEach(cleanup);

describe('ChatDock', () => {
  it('restores the persisted open state on mount', async () => {
    localStorage.setItem('hub-chat-open', 'true');
    chatApi.listConversations.mockResolvedValueOnce([]);

    renderDock();

    await waitFor(() => {
      expect(chatApi.listConversations).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('chat-panel').className).toContain('translate-x-0');
  });

  it('reopens on the conversations list instead of restoring the last thread', async () => {
    const user = userEvent.setup();
    chatApi.listConversations.mockResolvedValue([
      { ...conversation, updatedAt: '2026-05-18T00:00:00Z' },
    ]);
    chatApi.fetchConversation.mockResolvedValue({
      conversation,
      messages: [message],
      invocations: [],
    });

    renderDock();

    await user.click(screen.getByTestId('chat-launcher'));
    await screen.findByText(/Conversations · 1/);

    await user.click(screen.getByTestId('chat-conversation-select'));
    await screen.findByText('Agent reply');
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();

    await user.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(chatApi.listConversations).toHaveBeenCalledTimes(2);
    });
    expect(chatApi.fetchConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    expect(screen.getByText(/Conversations · 1/)).toBeTruthy();
    expect(screen.queryByText('Agent reply')).toBeNull();
  });
});

function renderDock() {
  return render(
    <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
      <ChatDock />
    </MemoryRouter>,
  );
}

const conversation = {
  id: 'conv-1',
  scope: 'project',
  projectId: 'goose-hub-self',
  workItemId: null,
  title: 'Project chat',
  runtime: 'codex',
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
};

const message = {
  id: 1,
  conversationId: 'conv-1',
  role: 'agent',
  content: 'Agent reply',
  runId: 'run-1',
  meta: null,
  createdAt: '2026-05-18T00:00:01Z',
};
