/** @vitest-environment jsdom */
import { flushSync } from 'react-dom';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

const conversation = {
  id: 'conv_123',
  scope: 'project',
  projectId: 'goose-hub-self',
  workItemId: null,
  title: 'Saved conversation',
  runtime: 'codex',
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
};

const fetchConversation = vi.fn(async () => ({
  conversation,
  messages: [
    {
      id: 1,
      conversationId: conversation.id,
      role: 'user',
      content: 'hello',
      runId: null,
      meta: null,
      createdAt: '2026-05-18T00:00:00Z',
    },
  ],
  invocations: [],
}));

const listConversations = vi.fn(async () => [conversation]);
const fetchToolManifest = vi.fn(async () => []);

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

vi.mock('./ChatThread', () => ({
  ChatThread: () => <div data-testid="chat-thread-view">Thread view</div>,
}));

vi.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  listConversations.mockClear();
  fetchConversation.mockClear();
  fetchToolManifest.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
});

function renderDock() {
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <ChatDock />
      </MemoryRouter>,
    );
  });
}

function clickSelector(selector: string) {
  const element = container.querySelector(selector);
  expect(element).toBeTruthy();
  flushSync(() => {
    (element as HTMLButtonElement).click();
  });
}

async function waitForCondition(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

describe('ChatDock', () => {
  it('preserves the active conversation when the panel close button is used', async () => {
    localStorage.setItem('hub-chat-open', 'true');
    localStorage.setItem('hub-chat-active-conversation-id', conversation.id);

    renderDock();

    await waitForCondition(
      () => container.querySelector('[data-testid="chat-thread-view"]') != null,
      'expected saved thread to be restored',
    );

    clickSelector('button[aria-label="Close chat"]');
    expect(localStorage.getItem('hub-chat-open')).toBe('false');
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe(conversation.id);

    clickSelector('[data-testid="chat-launcher"]');
    await waitForCondition(
      () => container.querySelector('[data-testid="chat-thread-view"]') != null,
      'expected thread view to return after normal reopen',
    );
  });

  it('closes from the launcher by clearing the persisted active conversation and reopening on the list', async () => {
    localStorage.setItem('hub-chat-open', 'true');
    localStorage.setItem('hub-chat-active-conversation-id', conversation.id);

    renderDock();

    await waitForCondition(
      () => container.querySelector('[data-testid="chat-thread-view"]') != null,
      'expected saved thread to be restored',
    );

    clickSelector('[data-testid="chat-launcher"]');

    expect(localStorage.getItem('hub-chat-open')).toBe('false');
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull();

    clickSelector('[data-testid="chat-launcher"]');
    await waitForCondition(
      () => container.querySelector('[data-testid="chat-conversation-list"]') != null,
      'expected conversation list to show after reopen',
    );
    expect(container.querySelector('[data-testid="chat-thread-view"]')).toBeNull();
  });
});
