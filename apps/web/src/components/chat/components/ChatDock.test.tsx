/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

const OPEN_STORAGE_KEY = 'hub-chat-open';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';

vi.mock('./ChatLauncher', () => ({
  ChatLauncher: ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="chat-launcher"
      aria-label={open ? 'Close Hub Chat' : 'Open Hub Chat'}
      aria-pressed={open}
      onClick={onToggle}
    >
      {open ? 'close' : 'open'}
    </button>
  ),
}));

vi.mock('./ChatPanel', () => ({
  ChatPanel: ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const view = !open
      ? 'closed'
      : localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)
        ? 'thread'
        : 'list';

    return (
      <div data-testid="chat-panel" data-open={String(open)} data-view={view}>
        <button type="button" aria-label="Close chat" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          data-testid="chat-panel-select-thread"
          onClick={() => {
            localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, 'conv-123');
          }}
        >
          Select thread
        </button>
        <span>
          {view === 'thread' ? 'Thread view' : view === 'list' ? 'List view' : 'Closed view'}
        </span>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe('ChatDock', () => {
  it('opens without clearing the active conversation when the launcher is clicked from closed state', async () => {
    const user = userEvent.setup();
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, 'conv-123');

    render(<ChatDock />);

    await user.click(screen.getByTestId('chat-launcher'));

    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBe('conv-123');
    expect(localStorage.getItem(OPEN_STORAGE_KEY)).toBe('true');
    expect(screen.getByText('Thread view')).toBeTruthy();
  });

  it('resets to list view after closing from the header button and reopening', async () => {
    const user = userEvent.setup();
    render(<ChatDock />);

    await user.click(screen.getByTestId('chat-launcher'));
    await user.click(screen.getByTestId('chat-panel-select-thread'));

    await user.click(screen.getByLabelText('Close chat'));
    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(OPEN_STORAGE_KEY)).toBe('false');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByText('List view')).toBeTruthy();
  });

  it('resets to list view after closing from the launcher and reopening', async () => {
    const user = userEvent.setup();
    render(<ChatDock />);

    await user.click(screen.getByTestId('chat-launcher'));
    await user.click(screen.getByTestId('chat-panel-select-thread'));

    await user.click(screen.getByTestId('chat-launcher'));
    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(OPEN_STORAGE_KEY)).toBe('false');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByText('List view')).toBeTruthy();
  });
});
