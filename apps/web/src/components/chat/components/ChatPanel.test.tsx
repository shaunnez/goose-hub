/** @vitest-environment jsdom */
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    act: actual.act ?? (async (callback: () => unknown) => await callback()),
  };
});

import type { ChatConversationDto, ChatMessageDto } from '@/lib/types';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  useChatEvents: vi.fn(() => []),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';

function makeConversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Alpha thread',
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
    content: 'Restored thread content',
    runId: null,
    meta: null,
    createdAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

function renderPanel(open: boolean, restoreLastConversationOnOpen?: boolean) {
  render(
    <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
      <ChatPanel
        open={open}
        onClose={() => {}}
        restoreLastConversationOnOpen={restoreLastConversationOnOpen}
      />
    </MemoryRouter>,
  );
}

describe('ChatPanel', () => {
  it('restores the persisted conversation by default when reopening', async () => {
    const { fetchConversation, fetchToolManifest, listConversations } = await import(
      '@/lib/api/chat'
    );
    const conversation = makeConversation();
    vi.mocked(fetchToolManifest).mockResolvedValue([]);
    vi.mocked(listConversations).mockResolvedValue([conversation]);
    vi.mocked(fetchConversation).mockResolvedValue({
      conversation,
      messages: [makeMessage()],
      invocations: [],
    });
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversation.id);

    renderPanel(true);

    expect(await screen.findByText('Restored thread content')).toBeTruthy();
    expect(fetchConversation).toHaveBeenCalledWith(conversation.id);
  });

  it('resets to the list view on reopen when restoreLastConversationOnOpen is false', async () => {
    const user = userEvent.setup();
    const { fetchConversation, fetchToolManifest, listConversations } = await import(
      '@/lib/api/chat'
    );
    const conversation = makeConversation();
    const threadMessage = makeMessage({ content: 'Conversation-only content' });
    vi.mocked(fetchToolManifest).mockResolvedValue([]);
    vi.mocked(listConversations).mockResolvedValue([conversation]);
    vi.mocked(fetchConversation).mockResolvedValue({
      conversation,
      messages: [threadMessage],
      invocations: [],
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open={false} onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    await screen.findByTestId('chat-conversation-list');
    await user.click(await screen.findByTestId('chat-conversation-select'));

    expect(await screen.findByText('Conversation-only content')).toBeTruthy();
    expect(fetchConversation).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open={false} onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter initialEntries={['/projects/goose-hub-self']}>
        <ChatPanel open onClose={() => {}} restoreLastConversationOnOpen={false} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('chat-conversation-list')).toBeTruthy());
    expect(screen.queryByText('Conversation-only content')).toBeNull();
    expect(fetchConversation).toHaveBeenCalledTimes(1);
  });
});
