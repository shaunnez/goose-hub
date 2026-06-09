/** @vitest-environment jsdom */
import { fetchIssues, fetchMilestoneIssues } from '@/lib/api';
import { useProjectBudgetStatus } from '@/lib/project-budget';
import { useActiveMilestone } from '@/state/active-milestone';
import { useActiveProject } from '@/state/active-project';
import { useLaneVisibility } from '@/state/lane-visibility';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './Board';

vi.mock('@/lib/api', () => ({
  fetchIssues: vi.fn(),
  fetchMilestoneIssues: vi.fn(),
}));

vi.mock('@/lib/project-budget', () => ({
  useProjectBudgetStatus: vi.fn(),
}));

vi.mock('@/state/active-milestone', () => ({
  useActiveMilestone: vi.fn(),
}));

vi.mock('@/state/active-project', () => ({
  useActiveProject: vi.fn(),
}));

vi.mock('@/state/lane-visibility', () => ({
  useLaneVisibility: vi.fn(),
}));

vi.mock('@/components/ui/ProjectBudgetBanner', () => ({
  ProjectBudgetBanner: () => null,
}));

vi.mock('../lib/jira-import', () => ({
  canUseAssignedToMeJiraImport: () => false,
  canUseManualJiraImport: () => false,
}));

vi.mock('./BoardColumn', () => ({
  BoardColumn: () => <div data-testid="board-column" />,
}));

vi.mock('./JiraAssignedImportAction', () => ({
  JiraAssignedImportAction: () => null,
}));

vi.mock('./JiraImportDialog', () => ({
  JiraImportDialog: () => null,
}));

vi.mock('./NewLocalIssueDialog', () => ({
  NewLocalIssueDialog: () => null,
}));

class MockEventSource {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
}

function renderBoard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Board projectSlug="local-proj" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.mocked(fetchIssues).mockResolvedValue([]);
    vi.mocked(fetchMilestoneIssues).mockResolvedValue([]);
    vi.mocked(useProjectBudgetStatus).mockReturnValue({ data: null } as ReturnType<
      typeof useProjectBudgetStatus
    >);
    vi.mocked(useActiveMilestone).mockReturnValue({
      milestones: [],
      loading: false,
      error: null,
      activeNumber: null,
      setActiveNumber: vi.fn(),
    });
    vi.mocked(useActiveProject).mockReturnValue({
      projects: [
        {
          id: 'local-proj',
          slug: 'local-proj',
          name: 'Local Project',
          color: '#000000',
          source: { kind: 'local-db' },
        },
      ],
      loading: false,
      error: null,
      activeSlug: 'local-proj',
      setActiveSlug: vi.fn(),
    });
    vi.mocked(useLaneVisibility).mockReturnValue({
      hidden: new Set(),
      toggle: vi.fn(),
      reset: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the local create button as New Local Task for local-db projects', async () => {
    renderBoard();

    await waitFor(() => expect(fetchIssues).toHaveBeenCalledWith('local-proj'));

    expect(screen.getByRole('button', { name: /new local task/i })).toBeTruthy();
  });
});
