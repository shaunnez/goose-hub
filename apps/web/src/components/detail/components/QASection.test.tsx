/** @vitest-environment jsdom */
import { fetchEvents, fetchIssueCosts } from '@/lib/api';
import type { AgentEventDto, WorkItemCostsDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QASection } from './QASection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  fetchIssueCosts: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchIssueCosts).mockResolvedValue({
    workItemId: 'wi-1',
    totalUsd: 0,
    hasEstimated: false,
    rows: [],
  });
});

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

  it('renders disposition pill on QA findings (#468)', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([
      qaEvent({
        verdict: 'fail',
        overallScore: 60,
        threshold: 70,
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: {
            passed: false,
            findings: [
              {
                tier: 'functional',
                severity: 'error',
                description: 'AC 2 fails — boundary case',
                disposition: 'follow-up',
                dispositionRef: '#345',
              },
              {
                tier: 'functional',
                severity: 'error',
                description: 'AC 3 fails — invalid input',
                disposition: 'fixed',
                dispositionRef: 'def5678',
              },
              {
                tier: 'functional',
                severity: 'warning',
                description: 'naming nit',
                disposition: 'out-of-scope',
                dispositionRef: 'cleanup separately',
              },
            ],
          },
          regression: { passed: true, findings: [] },
        },
      }),
    ]);
    render_(<QASection projectSlug="proj" id="42" />);
    await waitFor(() => {
      const pills = screen.getAllByTestId('qa-finding-disposition');
      expect(pills.length).toBeGreaterThanOrEqual(3);
      const text = pills.map((p) => p.textContent ?? '').join('\n');
      expect(text).toContain('follow-up #345');
      expect(text).toContain('fixed');
      expect(text).toContain('out-of-scope');
    });
  });

  it('renders the QA cost badge in the header when QA-stage rows exist', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([
      qaEvent({
        verdict: 'pass',
        overallScore: 85,
        threshold: 70,
        tierResults: passingTiers,
      }),
    ]);
    const costs: WorkItemCostsDto = {
      workItemId: 'wi-1',
      totalUsd: 0.05,
      hasEstimated: false,
      rows: [
        {
          runId: 'r-qa',
          workItemId: 'wi-1',
          stage: 'qa',
          skill: 'qa-test',
          modelId: 'claude-sonnet-4-6',
          provider: 'claude' as const,
          inputTokens: 600,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 200,
          reasoningOutputTokens: 0,
          costUsd: 0.05,
          costLabel: 'exact',
          cacheHitRatio: 0,
          personaId: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costs);

    render_(<QASection projectSlug="proj" id="42" />);
    await waitFor(() => {
      const badge = screen.getByTestId('cost-badge');
      expect(badge.textContent).toContain('$0.05');
      expect(badge.textContent).toContain('800');
    });
  });
});
