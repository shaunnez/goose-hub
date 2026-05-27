/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JiraImportDialog } from './JiraImportDialog';

vi.mock('@/lib/api', () => ({
  importJiraIssue: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <JiraImportDialog open={open} projectSlug="proj" onClose={onClose} onImported={onImported} />
    </QueryClientProvider>,
  );
  return { onClose, onImported };
}

describe('JiraImportDialog', () => {
  it('does not render when closed', () => {
    renderDialog(false);
    expect(screen.queryByTestId('jira-import-dialog')).toBeNull();
  });

  it('imports a Jira key and reports the imported item', async () => {
    const { importJiraIssue } = await import('@/lib/api');
    vi.mocked(importJiraIssue).mockResolvedValue({
      item: {
        id: 'local:proj#1',
        externalId: '1',
        jiraKey: 'TAS-123',
        jiraUrl: 'https://company.atlassian.net/browse/TAS-123',
        title: 'Manual Jira import',
        imported: true,
      },
    });
    const user = userEvent.setup();
    const { onImported } = renderDialog();

    await user.type(screen.getByTestId('jira-import-input'), 'TAS-123');
    await user.click(screen.getByTestId('jira-import-submit'));

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: '1', jiraKey: 'TAS-123' }),
      ),
    );
    expect(importJiraIssue).toHaveBeenCalledWith('proj', 'TAS-123');
  });

  it('surfaces provider failures without closing', async () => {
    const { importJiraIssue } = await import('@/lib/api');
    vi.mocked(importJiraIssue).mockRejectedValue(new Error('Jira issue not found'));
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.type(screen.getByTestId('jira-import-input'), 'TAS-404');
    await user.click(screen.getByTestId('jira-import-submit'));

    await waitFor(() => expect(screen.getByTestId('jira-import-error')).toBeTruthy());
    expect(screen.getByTestId('jira-import-error').textContent).toContain('Jira issue not found');
    expect(onClose).not.toHaveBeenCalled();
  });
});
