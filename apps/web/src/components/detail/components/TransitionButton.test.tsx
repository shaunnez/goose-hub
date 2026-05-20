/** @vitest-environment jsdom */
import { fetchLegalTargets, transitionState } from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransitionButton } from './TransitionButton';

vi.mock('@/lib/api', () => ({
  fetchLegalTargets: vi.fn(),
  transitionState: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchLegalTargets).mockResolvedValue({
    from: 'factory:accepted',
    legalTargets: ['factory:investigating', 'factory:dev-ready'],
  });
  vi.mocked(transitionState).mockResolvedValue({ status: 200, data: {} });
});

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

describe('TransitionButton', () => {
  it('renders legal targets from the endpoint instead of a browser table', async () => {
    render_(<TransitionButton projectSlug="proj" id="42" currentState="factory:accepted" />);

    fireEvent.click(await screen.findByTestId('transition-button'));

    expect(screen.getByTestId('transition-target-factory:investigating')).toBeTruthy();
    expect(screen.getByTestId('transition-target-factory:dev-ready')).toBeTruthy();
    expect(screen.queryByTestId('transition-target-factory:grilling')).toBeNull();
  });

  it('uses the endpoint from-state when posting the transition', async () => {
    render_(<TransitionButton projectSlug="proj" id="42" currentState="factory:accepted" />);

    fireEvent.click(await screen.findByTestId('transition-button'));
    fireEvent.click(screen.getByTestId('transition-target-factory:dev-ready'));

    await waitFor(() => {
      expect(transitionState).toHaveBeenCalledWith(
        'proj',
        '42',
        'factory:accepted',
        'factory:dev-ready',
      );
    });
  });

  it('renders disabled when the endpoint returns no legal targets', async () => {
    vi.mocked(fetchLegalTargets).mockResolvedValueOnce({
      from: 'factory:archived',
      legalTargets: [],
    });

    render_(<TransitionButton projectSlug="proj" id="42" currentState="factory:archived" />);

    expect(await screen.findByTestId('transition-button-disabled')).toBeTruthy();
  });
});
