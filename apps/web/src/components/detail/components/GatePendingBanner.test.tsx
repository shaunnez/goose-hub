/** @vitest-environment jsdom */
import { fetchEvents, transitionState } from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatePendingBanner } from './GatePendingBanner';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  transitionState: vi.fn(),
}));

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{jsx}</QueryClientProvider>
    </MemoryRouter>,
  );
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

describe('GatePendingBanner — factory:gate-pending', () => {
  it('renders info-variant banner with "Question ready — grill" message', () => {
    render_(<GatePendingBanner state="factory:gate-pending" projectSlug="proj" id="42" />);
    const banner = screen.getByTestId('gate-pending-banner');
    expect(banner.getAttribute('data-variant')).toBe('info');
    expect(banner.textContent).toContain('Question ready');
  });

  it('renders Grill link pointing at the grill section of this issue', () => {
    render_(<GatePendingBanner state="factory:gate-pending" projectSlug="proj" id="42" />);
    const grill = screen.getByTestId('gate-action-grill') as HTMLAnchorElement;
    expect(grill).toBeTruthy();
    expect(grill.getAttribute('href')).toBe('/projects/proj/items/42/grill');
  });

  it('does not render needs-human action buttons in gate-pending variant', () => {
    render_(<GatePendingBanner state="factory:gate-pending" projectSlug="proj" id="42" />);
    expect(screen.queryByTestId('gate-action-send-to-triage')).toBeNull();
    expect(screen.queryByTestId('gate-action-reject')).toBeNull();
  });

  it('omits Grill link when projectSlug/id are absent', () => {
    render_(<GatePendingBanner state="factory:gate-pending" />);
    expect(screen.queryByTestId('gate-action-grill')).toBeNull();
  });
});
