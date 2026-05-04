/** @vitest-environment jsdom */
import { fetchEvents, transitionState } from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatePendingBanner } from './GatePendingBanner';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  transitionState: vi.fn(),
}));

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

const DECISION_SUMMARY_EVENT = {
  id: 1,
  projectId: 'proj',
  workItemId: 'github:org/repo#42',
  kind: 'agent.decision-summary',
  payload: { summary: 'Retry cap hit after 3 attempts on implement skill' },
  runId: 'run-1',
  createdAt: '2026-05-04T10:00:00Z',
};

describe('GatePendingBanner — factory:needs-human', () => {
  it('renders nothing for non-gate states', () => {
    render_(<GatePendingBanner state="factory:in-progress" projectSlug="proj" id="42" />);
    expect(screen.queryByTestId('gate-pending-banner')).toBeNull();
  });

  it('renders all 4 recovery buttons', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([DECISION_SUMMARY_EVENT]);
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('gate-action-send-to-triage')).toBeTruthy();
      expect(screen.getByTestId('gate-action-send-to-dev')).toBeTruthy();
      expect(screen.getByTestId('gate-action-send-to-qa')).toBeTruthy();
      expect(screen.getByTestId('gate-action-reject')).toBeTruthy();
    });
  });

  it('shows escalation reason excerpt from last decision-summary', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([DECISION_SUMMARY_EVENT]);
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('escalation-reason').textContent).toContain(
        'Retry cap hit after 3 attempts',
      );
    });
  });

  it('renders buttons even when events fetch returns empty', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('gate-action-send-to-dev')).toBeTruthy();
    });
    expect(screen.queryByTestId('escalation-reason')).toBeNull();
  });

  it('renders buttons even when events fetch fails', async () => {
    vi.mocked(fetchEvents).mockRejectedValueOnce(new Error('network error'));
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('gate-action-send-to-dev')).toBeTruthy();
    });
  });

  it('Dev button calls transitionState with factory:dev-ready', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    vi.mocked(transitionState).mockResolvedValueOnce({ status: 200, data: {} });
    render_(
      <GatePendingBanner
        state="factory:needs-human"
        projectSlug="proj"
        id="42"
        onTransitioned={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByTestId('gate-action-send-to-dev'));
    fireEvent.click(screen.getByTestId('gate-action-send-to-dev'));
    await waitFor(() => {
      expect(transitionState).toHaveBeenCalledWith(
        'proj',
        '42',
        'factory:needs-human',
        'factory:dev-ready',
      );
    });
  });

  it('Triage button calls transitionState with factory:triaging', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    vi.mocked(transitionState).mockResolvedValueOnce({ status: 200, data: {} });
    render_(
      <GatePendingBanner
        state="factory:needs-human"
        projectSlug="proj"
        id="42"
        onTransitioned={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByTestId('gate-action-send-to-triage'));
    fireEvent.click(screen.getByTestId('gate-action-send-to-triage'));
    await waitFor(() => {
      expect(transitionState).toHaveBeenCalledWith(
        'proj',
        '42',
        'factory:needs-human',
        'factory:triaging',
      );
    });
  });
});
