/** @vitest-environment jsdom */
import type { InboxItemDto, MilestoneDto, ProjectSummary } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromoteModal } from './PromoteModal';

const mockFetchProjects = vi.fn<() => Promise<ProjectSummary[]>>();
const mockFetchMilestones = vi.fn<() => Promise<MilestoneDto[]>>();
const mockPromoteInboxItem = vi.fn<() => Promise<void>>();

vi.mock('@/lib/api', () => ({
  fetchProjects: mockFetchProjects,
  fetchMilestones: mockFetchMilestones,
  promoteInboxItem: mockPromoteInboxItem,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockFetchProjects.mockResolvedValue([
    {
      id: 'project-1',
      name: 'Goose Hub',
      slug: 'goose-hub-self',
      color: '#000000',
      source: { kind: 'github', repo: 'goose-hub/self' },
    },
  ]);
  mockFetchMilestones.mockResolvedValue([
    {
      id: 'milestone-1',
      title: 'Active milestone',
      number: 12,
      isActive: true,
      state: 'open',
      openIssues: 4,
      closedIssues: 1,
    },
  ]);
  mockPromoteInboxItem.mockResolvedValue(undefined);
});

function makeItem(type: InboxItemDto['type']): InboxItemDto {
  return {
    id: 42,
    title: `${type} idea`,
    body: `Body for ${type}`,
    type,
    createdAt: '2026-05-20T10:00:00Z',
  };
}

function renderModal(item: InboxItemDto) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <PromoteModal item={item} onClose={onClose} />
    </QueryClientProvider>,
  );

  return { onClose };
}

async function chooseProject(user: ReturnType<typeof userEvent.setup>) {
  const select = await screen.findByTestId('promote-project-select');
  await user.selectOptions(select, 'goose-hub-self');
}

describe('PromoteModal enhancement toggle', () => {
  it('renders the bug enhancement copy and test id for bug promotions', async () => {
    renderModal(makeItem('bug'));

    expect(await screen.findByTestId('enhance-bug-checkbox')).toBeTruthy();
    expect(screen.getByLabelText('Enhance bug report')).toBeTruthy();
  });

  it('renders the feature enhancement copy and test id for non-bug promotions', async () => {
    renderModal(makeItem('feature'));

    expect(await screen.findByTestId('enhance-feature-checkbox')).toBeTruthy();
    expect(screen.getByLabelText('Enhance feature spec')).toBeTruthy();
  });

  it('passes enhance=false for non-bug promotions when the toggle is unchecked', async () => {
    const user = userEvent.setup();
    renderModal(makeItem('feature'));

    const checkbox = await screen.findByTestId('enhance-feature-checkbox');
    await user.click(checkbox);
    await chooseProject(user);
    await user.click(screen.getByTestId('promote-next'));
    await user.click(screen.getByTestId('promote-confirm'));

    await waitFor(() => {
      expect(mockPromoteInboxItem).toHaveBeenCalledWith(42, 'goose-hub-self', 12, false);
    });
  });
});
