/** @vitest-environment jsdom */
import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QASection } from './QASection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
}));

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

function qaEvent(payload: unknown): AgentEventDto {
  return {
    id: 1,
    projectId: 'proj',
    workItemId: 'gh:owner/repo#42',
    runId: 'r1',
    kind: 'qa.completed',
    payload,
    createdAt: new Date().toISOString(),
  } as AgentEventDto;
}

const passingTiers = {
  structural: { passed: true, findings: [] },
  functional: { passed: true, findings: [] },
  regression: { passed: true, findings: [] },
};

describe('QASection', () => {
  it('renders the empty state when no qa.completed event is present', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    render_(<QASection projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('qa-empty-state')).toBeTruthy();
    });
  });

  it('renders tier-based fallback stats when testRun is absent', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([
      qaEvent({
        verdict: 'pass',
        overallScore: 85,
        threshold: 70,
        tierResults: passingTiers,
      }),
    ]);
    render_(<QASection projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('qa-section')).toBeTruthy();
    });
    // Wall-time card shows the placeholder, and there's no test-suites block.
    expect(screen.getByText('not tracked')).toBeTruthy();
    expect(screen.queryByTestId('qa-test-suites')).toBeNull();
  });

  it('renders the test-suites block when testRun is present', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([
      qaEvent({
        verdict: 'pass',
        overallScore: 85,
        threshold: 70,
        tierResults: passingTiers,
        testRun: {
          wallTimeMs: 7700,
          total: 39,
          passed: 38,
          failed: 0,
          skipped: 1,
          success: true,
          suites: [
            {
              name: 'cart.test.ts',
              filePath: '/wt/cart.test.ts',
              total: 18,
              passed: 18,
              failed: 0,
              skipped: 0,
              durationMs: 412,
              status: 'passed',
            },
            {
              name: 'funnel.test.ts',
              filePath: '/wt/funnel.test.ts',
              total: 12,
              passed: 11,
              failed: 1,
              skipped: 0,
              durationMs: 288,
              status: 'failed',
            },
          ],
        },
      }),
    ]);
    render_(<QASection projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('qa-test-suites')).toBeTruthy();
    });
    expect(screen.getByText('cart.test.ts')).toBeTruthy();
    expect(screen.getByText('funnel.test.ts')).toBeTruthy();
    // Pass / Fail card uses the testRun numbers (38 / 0), not the tier counts (3 / 0).
    expect(screen.getByText('38 / 0')).toBeTruthy();
    // Wall-time card uses the formatted duration.
    expect(screen.getByText('7.70s')).toBeTruthy();
  });
});
