/** @vitest-environment jsdom */
import { flushSync } from 'react-dom';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';
const OPEN_STORAGE_KEY = 'hub-chat-open';

vi.mock('./ChatLauncher', () => ({
  ChatLauncher: ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="chat-launcher"
      aria-pressed={String(open)}
      onClick={onToggle}
    >
      Toggle
    </button>
  ),
}));

vi.mock('./ChatPanel', () => ({
  ChatPanel: ({ open }: { open: boolean }) =>
    open ? (
      <div data-testid="chat-panel-view">
        {localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) == null ? 'list' : 'thread'}
      </div>
    ) : null,
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderChatDock() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => {
    root?.render(<ChatDock />);
  });
}

function clickLauncher() {
  const launcher = container?.querySelector('[data-testid="chat-launcher"]');
  expect(launcher).not.toBeNull();
  flushSync(() => {
    (launcher as HTMLButtonElement).click();
  });
}

function panelViewText() {
  return container?.querySelector('[data-testid="chat-panel-view"]')?.textContent ?? null;
}

afterEach(() => {
  flushSync(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
});

describe('ChatDock', () => {
  it('clears the persisted active conversation when the launcher closes the panel', async () => {
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, 'conv-123');
    renderChatDock();

    clickLauncher();
    expect(panelViewText()).toBe('thread');

    clickLauncher();

    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBeNull();
  });

  it('reopens on the list view after the launcher closes an active thread', async () => {
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, 'conv-123');
    renderChatDock();

    clickLauncher();
    expect(panelViewText()).toBe('thread');

    clickLauncher();
    expect(panelViewText()).toBeNull();

    clickLauncher();

    expect(panelViewText()).toBe('list');
    expect(localStorage.getItem(OPEN_STORAGE_KEY)).toBe('true');
  });
});
