/** @vitest-environment jsdom */
import type { ChatConversationDto } from '@/lib/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { ConversationList } from './ConversationList';

const { fetchConversationMock, fetchToolManifestMock, listConversationsMock } = vi.hoisted(() => ({
  fetchConversationMock: vi.fn(),
  fetchToolManifestMock: vi.fn(),
  listConversationsMock: vi.fn(),
}));

vi.mock('@/lib/api/chat', () => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchConversation: fetchConversationMock,
  fetchToolManifest: fetchToolManifestMock,
  listConversations: listConversationsMock,
  postMessage: vi.fn(),
  resolveInvocation: vi.fn(),
}));

vi.mock('../lib/useChatEvents', () => ({
  useChatEvents: () => [],
}));

vi.mock('./ChatThread', () => ({
  ChatThread: () => <div data-testid="chat-thread" />,
}));

vi.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

afterEach(cleanup);

afterEach(() => {
  localStorage.clear();
  fetchConversationMock.mockReset();
  fetchToolManifestMock.mockReset();
  listConversationsMock.mockReset();
});

const noop = () => {};

function conv(overrides: Partial<ChatConversationDto>): ChatConversationDto {
  return {
    id: `conv_${Math.random().toString(36).slice(2, 8)}`,
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: '',
    runtime: 'claude',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

describe('ConversationList', () => {
  it('renders the empty state when there are no conversations', () => {
    render(
      <ConversationList
        conversations={[]}
        activeConversationId={null}
        busy={false}
        onSelect={noop}
        onDelete={noop}
        onNew={noop}
      />,
    );
    expect(screen.getByText(/No conversations yet/)).toBeTruthy();
    expect(screen.getByTestId('chat-new-conversation')).toBeTruthy();
  });

  it('renders rows grouped by scope (item → project → global)', () => {
    render(
      <ConversationList
        conversations={[
          conv({ id: 'g1', scope: 'global', projectId: null, title: 'Global chat' }),
          conv({
            id: 'i1',
            scope: 'item',
            projectId: 'goose-hub-self',
            workItemId: 'github:owner/repo#42',
            title: 'Item chat',
          }),
          conv({ id: 'p1', scope: 'project', title: 'Project chat' }),
        ]}
        activeConversationId={null}
        busy={false}
        onSelect={noop}
        onDelete={noop}
        onNew={noop}
      />,
    );
    const groupLabels = screen.getAllByText(/^(Work item|Project|Global)$/);
    expect(groupLabels.map((el) => el.textContent)).toEqual(['Work item', 'Project', 'Global']);
  });

  it('invokes onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ConversationList
        conversations={[conv({ id: 'p1', scope: 'project', title: 'Hello' })]}
        activeConversationId={null}
        busy={false}
        onSelect={onSelect}
        onDelete={noop}
        onNew={noop}
      />,
    );
    const selectButton = screen.getByTestId('chat-conversation-select');
    fireEvent.click(selectButton);
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('confirms before deleting and calls onDelete only after the confirm click', () => {
    const onDelete = vi.fn();
    render(
      <ConversationList
        conversations={[conv({ id: 'p1', title: 'doomed' })]}
        activeConversationId={null}
        busy={false}
        onSelect={noop}
        onDelete={onDelete}
        onNew={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-conversation-delete'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-conversation-delete-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chat-conversation-delete-confirm'));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('highlights the active conversation row', () => {
    render(
      <ConversationList
        conversations={[conv({ id: 'p1', title: 'one' }), conv({ id: 'p2', title: 'two' })]}
        activeConversationId="p2"
        busy={false}
        onSelect={noop}
        onDelete={noop}
        onNew={noop}
      />,
    );
    const rows = screen.getAllByTestId('chat-conversation-row');
    const p2 = rows.find((r) => r.getAttribute('data-conversation-id') === 'p2');
    expect(p2?.className).toMatch(/border-accent/);
  });
});

describe('ChatPanel reopen reset', () => {
  it('restores the previous thread when opened without a new reset signal', async () => {
    const previous = conv({ id: 'p1', title: 'Saved thread' });
    localStorage.setItem('hub-chat-active-conversation-id', previous.id);
    listConversationsMock.mockResolvedValue([previous]);
    fetchConversationMock.mockResolvedValue({
      conversation: previous,
      messages: [],
      invocations: [],
    });
    fetchToolManifestMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <ChatPanel open onClose={noop} resetOnOpenKey={0} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchConversationMock).toHaveBeenCalledWith(previous.id));
    expect(screen.getByTestId('chat-thread')).toBeTruthy();
    expect(screen.queryByTestId('chat-conversation-list')).toBeNull();
  });

  it('resets to the conversation list on a reset-signaled reopen without clearing storage', async () => {
    const previous = conv({ id: 'p1', title: 'Saved thread' });
    localStorage.setItem('hub-chat-active-conversation-id', previous.id);
    listConversationsMock.mockResolvedValue([previous]);
    fetchToolManifestMock.mockResolvedValue([]);

    const { rerender } = render(
      <MemoryRouter>
        <ChatPanel open={false} onClose={noop} resetOnOpenKey={0} />
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter>
        <ChatPanel open onClose={noop} resetOnOpenKey={1} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('chat-conversation-list')).toBeTruthy());
    expect(fetchConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat-thread')).toBeNull();
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe(previous.id);
  });
});
