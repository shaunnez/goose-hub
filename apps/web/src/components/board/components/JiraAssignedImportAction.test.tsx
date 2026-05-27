/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JiraAssignedImportAction } from './JiraAssignedImportAction';

vi.mock('@/lib/api', () => ({
  importAssignedJiraIssues: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAction(milestoneNumber: number | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onImported = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <JiraAssignedImportAction
        projectSlug="proj"
        milestoneNumber={milestoneNumber}
        onImported={onImported}
      />
    </QueryClientProvider>,
  );
  return { onImported };
}

describe('JiraAssignedImportAction', () => {
  it('imports assigned Jira issues and shows result counts plus per-issue failures', async () => {
    const { importAssignedJiraIssues } = await import('@/lib/api');
    vi.mocked(importAssignedJiraIssues).mockResolvedValue({
      counts: { imported: 1, updated: 2, skipped: 0, stale: 1, failed: 1 },
      failures: [{ jiraKey: 'TAS-404', error: 'Jira issue not found' }],
    });
    const user = userEvent.setup();
    const { onImported } = renderAction(7);

    await user.click(screen.getByTestId('jira-assigned-import-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('jira-assigned-import-result').textContent).toContain(
        'Imported 1 Updated 2 Skipped 0 Stale 1 Failed 1',
      ),
    );
    expect(screen.getByText('TAS-404: Jira issue not found')).toBeTruthy();
    expect(importAssignedJiraIssues).toHaveBeenCalledWith('proj', { milestoneNumber: 7 });
    expect(onImported).toHaveBeenCalledOnce();
  });

  it('surfaces sync failures without clearing the board action', async () => {
    const { importAssignedJiraIssues } = await import('@/lib/api');
    vi.mocked(importAssignedJiraIssues).mockRejectedValue(
      new Error('Jira credentials are not configured'),
    );
    const user = userEvent.setup();
    renderAction();

    await user.click(screen.getByTestId('jira-assigned-import-submit'));

    await waitFor(() => expect(screen.getByTestId('jira-assigned-import-error')).toBeTruthy());
    expect(screen.getByTestId('jira-assigned-import-error').textContent).toContain(
      'Jira credentials are not configured',
    );
  });
});
