/** @vitest-environment jsdom */
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';
import { ChatLauncher } from './ChatLauncher';

const { listConversationsMock, fetchConversationMock, fetchToolManifestMock } = vi.hoisted(() => ({
  listConversationsMock: vi.fn(),
  fetchConversationMock: vi.fn(),
  fetchToolManifestMock: vi.fn(),
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

const conversation = {
  id: 'conv-1',
  title: 'Saved thread',
  scope: 'global',
  projectId: null,
  workItemId: null,
  runtime: 'codex',
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
};

const messages = [
  {
    id: 1,
    conversationId: 'conv-1',
    role: 'user',
    content: 'Restored message',
    runId: null,
    meta: null,
    createdAt: '2026-05-23T00:00:00.000Z',
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  listConversationsMock.mockReset();
  fetchConversationMock.mockReset();
  fetchToolManifestMock.mockReset();
  fetchToolManifestMock.mockResolvedValue([]);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function render(ui: ReactElement) {
  flushSync(() => {
    root.render(ui);
  });
}

function getByTestId(testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element with data-testid=${testId}`);
  }
  return element;
}

function getAllByTestId(testId: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(`[data-testid="${testId}"]`)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function getByRole(role: string, name: string): HTMLElement {
  const matcher = name.toLowerCase();
  const element = Array.from(
    container.querySelectorAll<HTMLElement>('[role],button,select,textarea'),
  )
    .filter((node) => (node.getAttribute('role') ?? node.tagName.toLowerCase()) === role)
    .find((node) => {
      const label = node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '';
      return label.toLowerCase().includes(matcher);
    });

  if (element == null) {
    throw new Error(`Missing ${role} named ${name}`);
  }

  return element;
}

async function waitFor(assertion: () => void, timeoutMs = 1000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function click(element: HTMLElement) {
  flushSync(() => {
    element.click();
  });
}

describe('ChatLauncher', () => {
  it('renders with aria-pressed reflecting open state', () => {
    render(<ChatLauncher open={false} onToggle={() => {}} />);
    expect(getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('false');

    render(<ChatLauncher open onToggle={() => {}} />);
    expect(getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('true');
  });

  it('fires onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<ChatLauncher open={false} onToggle={onToggle} />);

    click(getByTestId('chat-launcher'));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('reopens on the conversation list after closing an open thread', async () => {
    listConversationsMock.mockResolvedValue([conversation]);
    fetchConversationMock.mockResolvedValue({
      conversation,
      messages,
      invocations: [],
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <ChatDock />
      </MemoryRouter>,
    );

    click(getByTestId('chat-launcher'));
    await waitFor(() => expect(getByTestId('chat-conversation-list')).toBeTruthy());
    await waitFor(() => expect(getAllByTestId('chat-conversation-select')).toHaveLength(1));

    click(getAllByTestId('chat-conversation-select')[0]);
    await waitFor(() => expect(fetchConversationMock).toHaveBeenCalledWith('conv-1'));
    expect(localStorage.getItem('hub-chat-active-conversation-id')).toBe('conv-1');

    click(getByRole('button', 'Close chat'));
    await waitFor(() => expect(localStorage.getItem('hub-chat-active-conversation-id')).toBeNull());

    fetchConversationMock.mockClear();
    click(getByTestId('chat-launcher'));

    await waitFor(() => expect(getByTestId('chat-conversation-list')).toBeTruthy());
    expect(fetchConversationMock).not.toHaveBeenCalled();
  });
});
