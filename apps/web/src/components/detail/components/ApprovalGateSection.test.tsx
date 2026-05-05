/** @vitest-environment jsdom */
import { approveIssue, rejectIssue } from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalGateSection } from './ApprovalGateSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  approveIssue: vi.fn(),
  rejectIssue: vi.fn(),
}));

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

describe('ApprovalGateSection (#186)', () => {
  it('renders nothing when state is not factory:approved', () => {
    render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:in-progress" />);
    expect(screen.queryByTestId('approval-gate')).toBeNull();
  });

  it('renders Approve and Reject buttons when state is factory:approved', () => {
    render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
    expect(screen.getByTestId('approval-gate')).toBeTruthy();
    expect(screen.getByTestId('approve-btn')).toBeTruthy();
    expect(screen.getByTestId('reject-btn')).toBeTruthy();
  });

  it('Approve calls approveIssue API', async () => {
    vi.mocked(approveIssue).mockResolvedValueOnce({
      ok: true,
      sha: 'abc1234',
      prNumber: 99,
    });
    render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
    fireEvent.click(screen.getByTestId('approve-btn'));
    await waitFor(() => {
      expect(approveIssue).toHaveBeenCalledWith('proj', '42');
    });
  });

  it('shows conflict banner (not error) when approve returns conflict', async () => {
    vi.mocked(approveIssue).mockResolvedValueOnce({ ok: false, conflict: true });
    render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
    fireEvent.click(screen.getByTestId('approve-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('conflict-banner')).toBeTruthy();
      expect(screen.queryByTestId('approval-gate-error')).toBeNull();
    });
  });

  it('Reject opens the form, requires non-empty reason, and calls rejectIssue', async () => {
    vi.mocked(rejectIssue).mockResolvedValueOnce({ ok: true });
    render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
    fireEvent.click(screen.getByTestId('reject-btn'));
    const submit = screen.getByTestId('reject-submit') as HTMLButtonElement;
    // Disabled until a reason is typed.
    expect(submit.disabled).toBe(true);

    const input = screen.getByTestId('reject-reason-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'tests are flaky' } });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => {
      expect(rejectIssue).toHaveBeenCalledWith('proj', '42', 'tests are flaky');
    });
  });

  it('Cancel from the reject form returns to the buttons view', () => {
    render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
    fireEvent.click(screen.getByTestId('reject-btn'));
    expect(screen.queryByTestId('reject-submit')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reject-cancel'));
    expect(screen.queryByTestId('reject-submit')).toBeNull();
    expect(screen.getByTestId('approve-btn')).toBeTruthy();
  });

  it('shows API error when approve fails with a non-conflict error', async () => {
    vi.mocked(approveIssue).mockRejectedValueOnce(new Error('GitHub API unavailable'));
    render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
    fireEvent.click(screen.getByTestId('approve-btn'));
    await waitFor(() => {
      const el = screen.getByTestId('approval-gate-error');
      expect(el.textContent).toContain('GitHub API unavailable');
    });
  });
});
