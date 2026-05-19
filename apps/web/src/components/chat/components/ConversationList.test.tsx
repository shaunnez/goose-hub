/** @vitest-environment jsdom */
import type { ChatConversationDto } from '@/lib/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationList } from './ConversationList';

afterEach(cleanup);

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
