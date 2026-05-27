/** @vitest-environment jsdom */
import { fetchConversation, fetchToolManifest, listConversations } from '@/lib/api/chat';
import type { ChatConversationDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';
import { ChatLauncher } from './ChatLauncher';

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

const mockedListConversations = vi.mocked(listConversations);
const mockedFetchConversation = vi.mocked(fetchConversation);
const mockedFetchToolManifest = vi.mocked(fetchToolManifest);

const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';
const OPEN_STORAGE_KEY = 'hub-chat-open';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
}

function conversation(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'conv-1',
    scope: 'project',
    projectId: 'goose-hub-self',
    workItemId: null,
    title: 'Saved thread',
    runtime: 'codex',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

describe('ChatLauncher', () => {
  it('renders with aria-pressed reflecting open state', () => {
    const { rerender } = render(<ChatLauncher open={false} onToggle={() => {}} />);
    expect(screen.getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('false');
    rerender(<ChatLauncher open onToggle={() => {}} />);
    expect(screen.getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('true');
  });

  it('fires onToggle when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ChatLauncher open={false} onToggle={onToggle} />);
    await user.click(screen.getByTestId('chat-launcher'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('reopens the dock on the list view after closing from the launcher while open', async () => {
    const user = userEvent.setup();
    const savedConversation = conversation();

    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, savedConversation.id);
    localStorage.setItem(OPEN_STORAGE_KEY, 'true');
    mockedFetchToolManifest.mockResolvedValue([]);
    mockedListConversations.mockResolvedValue([savedConversation]);
    mockedFetchConversation.mockResolvedValue({
      conversation: savedConversation,
      messages: [
        {
          id: 1,
          conversationId: savedConversation.id,
          role: 'agent',
          content: 'Agent hello',
          runId: 'run-1',
          meta: null,
          createdAt: '2026-05-18T00:00:00Z',
        },
      ],
      invocations: [],
    });

    render(
      <Providers>
        <ChatDock />
      </Providers>,
    );

    expect(await screen.findByText('Agent hello')).toBeTruthy();

    await user.click(screen.getByTestId('chat-launcher'));
    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBeNull();
    await user.click(screen.getByTestId('chat-launcher'));

    expect(await screen.findByTestId('chat-conversation-list')).toBeTruthy();
    expect(screen.queryByText('Agent hello')).toBeNull();
  });
});
