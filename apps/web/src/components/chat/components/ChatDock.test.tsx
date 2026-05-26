/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

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

import { fetchConversation, fetchToolManifest, listConversations } from '@/lib/api/chat';

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(fetchToolManifest).mockResolvedValue([]);
});

describe('ChatDock', () => {
  it('reopens on the conversation list after closing an active thread', async () => {
    vi.mocked(listConversations).mockResolvedValue([
      {
        id: 'conv-1',
        scope: 'project',
        projectId: 'goose-hub-self',
        workItemId: null,
        title: 'Existing thread',
        runtime: 'codex',
        createdAt: '2026-05-18T00:00:00Z',
        updatedAt: '2026-05-18T00:00:00Z',
      },
    ]);
    vi.mocked(fetchConversation).mockResolvedValue({
      conversation: {
        id: 'conv-1',
        scope: 'project',
        projectId: 'goose-hub-self',
        workItemId: null,
        title: 'Existing thread',
        runtime: 'codex',
        createdAt: '2026-05-18T00:00:00Z',
        updatedAt: '2026-05-18T00:00:00Z',
      },
      messages: [
        {
          id: 1,
          conversationId: 'conv-1',
          role: 'user',
          content: 'Hello',
          runId: null,
          meta: null,
          createdAt: '2026-05-18T00:00:00Z',
        },
      ],
      invocations: [],
    });

    render(
      <MemoryRouter>
        <ChatDock />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => expect(screen.getByTestId('chat-conversation-list')).toBeTruthy());
    expect(screen.queryByTestId('chat-input')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-conversation-select'));

    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeTruthy());
    expect(fetchConversation).toHaveBeenCalledWith('conv-1');

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel').className).toContain('translate-x-full');
    });

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => expect(screen.getByTestId('chat-conversation-list')).toBeTruthy());
    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(fetchConversation).toHaveBeenCalledTimes(1);
  });
});
