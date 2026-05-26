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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchToolManifest).mockResolvedValue([]);
});

const conversation = {
  id: 'conv-1',
  scope: 'project' as const,
  projectId: 'goose-hub-self',
  workItemId: null,
  title: 'Project chat',
  runtime: 'codex' as const,
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
};

function renderDock() {
  render(
    <MemoryRouter>
      <ChatDock />
    </MemoryRouter>,
  );
}

describe('ChatDock', () => {
  it('reopens to the list view after a launcher-driven close while preserving the active conversation id', async () => {
    vi.mocked(listConversations).mockResolvedValue([conversation]);
    vi.mocked(fetchConversation).mockResolvedValue({
      conversation,
      messages: [],
      invocations: [],
    });

    renderDock();

    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('chat-conversation-select'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeTruthy();
    });

    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');
    expect(fetchConversation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('chat-launcher'));
    fireEvent.click(screen.getByTestId('chat-launcher'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-conversation-list')).toBeTruthy();
    });

    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');
    expect(fetchConversation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('chat-conversation-select'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeTruthy();
    });

    expect(fetchConversation).toHaveBeenCalledTimes(2);
  });
});
