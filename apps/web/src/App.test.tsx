/** @vitest-environment jsdom */
import { fetchProjects } from '@/lib/api';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    fetchProjects: vi.fn(),
  };
});

vi.mock('./components/board/components/AllProjectsBoard', () => ({
  AllProjectsBoard: () => <div data-testid="all-projects-board">all-projects-board</div>,
}));

vi.mock('./components/board/components/Board', () => ({
  Board: ({ projectSlug }: { projectSlug: string }) => (
    <div data-testid="board">board:{projectSlug}</div>
  ),
}));

vi.mock('./components/chat/components/ChatDock', () => ({
  ChatDock: () => null,
}));

vi.mock('./components/costs/CostsPage', () => ({
  CostsPage: () => <div>costs-page</div>,
}));

vi.mock('./components/detail/components/DetailPage', () => ({
  DetailPage: () => <div>detail-page</div>,
}));

vi.mock('./components/inbox/components/InboxList', () => ({
  InboxList: () => <div>inbox-page</div>,
}));

vi.mock('./components/interventions/OperatorQueuePage', () => ({
  OperatorQueuePage: () => <div>operator-queue-page</div>,
}));

vi.mock('./components/roster/components/RosterPage', () => ({
  RosterPage: () => <div>roster-page</div>,
}));

vi.mock('./components/settings/components/SettingsPage', () => ({
  SettingsPage: () => <div>settings-page</div>,
}));

vi.mock('./state/active-milestone', () => ({
  ActiveMilestoneProvider: ({ children }: { children: React.ReactNode; projectSlug: string }) =>
    children,
}));

vi.mock('./state/lane-visibility', () => ({
  LaneVisibilityProvider: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(cleanup);

describe('App all-projects switcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('sidebar-collapsed', 'false');
    vi.mocked(fetchProjects).mockResolvedValue([
      { slug: 'project-alpha', name: 'Project Alpha', color: '#f97316' },
      { slug: 'project-beta', name: 'Project Beta', color: '#0ea5e9' },
    ]);
  });

  it('keeps All Projects selected on /projects/all', async () => {
    window.history.pushState({}, '', '/projects/all');

    render(<App />);

    const select = (await screen.findByLabelText('Active project')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('all'));

    expect(screen.getByDisplayValue('All Projects')).toBeTruthy();
    expect(window.location.pathname).toBe('/projects/all');
  });

  it('navigates from /projects/all to a selected project and updates the switcher', async () => {
    window.history.pushState({}, '', '/projects/all');

    render(<App />);

    const select = (await screen.findByLabelText('Active project')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('all'));

    fireEvent.change(select, { target: { value: 'project-alpha' } });

    await waitFor(() => expect(window.location.pathname).toBe('/projects/project-alpha'));
    await waitFor(() => expect(select.value).toBe('project-alpha'));
    expect(screen.getByDisplayValue('Project Alpha')).toBeTruthy();
    expect(screen.getByTestId('board').textContent).toBe('board:project-alpha');
  });
});
