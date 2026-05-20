import { createPlaybook, fetchPlaybook, fetchPlaybooks } from '@/lib/api';
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybooksTab } from './PlaybooksTab';

vi.mock('@/lib/api', () => ({
  createPlaybook: vi.fn(),
  fetchPlaybook: vi.fn(),
  fetchPlaybooks: vi.fn(),
}));

const mockCreatePlaybook = vi.mocked(createPlaybook);
const mockFetchPlaybook = vi.mocked(fetchPlaybook);
const mockFetchPlaybooks = vi.mocked(fetchPlaybooks);

function renderPlaybooksTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlaybooksTab projectSlug="goose-hub-self" />
    </QueryClientProvider>,
  );
}

describe('PlaybooksTab', () => {
  beforeEach(() => {
    mockFetchPlaybooks.mockResolvedValue([]);
    mockFetchPlaybook.mockResolvedValue({
      id: 42,
      projectId: 'goose-hub-self',
      windowStartAt: '2026-05-01T00:00:00.000Z',
      windowEndAt: '2026-05-08T00:00:00.000Z',
      lifecycleCount: 10,
      topPatternCount: 0,
      topCandidateCount: 0,
      coachProposalCount: 0,
      createdAt: '2026-05-08T00:00:00.000Z',
      manifest: {
        outcome: 'success',
        workItemNumber: 0,
        windowStartAt: '2026-05-01T00:00:00.000Z',
        windowEndAt: '2026-05-08T00:00:00.000Z',
        lifecycleCount: 10,
        summary: {
          wentWell: 'good',
          didNotGoWell: 'bad',
          architecturalTakeaway: 'takeaway',
        },
        aggregatedLearnings: [],
        topPatterns: [],
        improvementCandidates: [],
        gateThresholds: [],
        costBaselines: [],
        decisionSummaries: [],
      },
    });
    mockCreatePlaybook.mockResolvedValue({ playbookId: 42, lifecycleCount: 10 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('generates a playbook for the selected lifecycle window and refreshes the list', async () => {
    const user = userEvent.setup();
    renderPlaybooksTab();

    await user.click(screen.getByRole('button', { name: 'Last 10 lifecycles' }));
    await user.click(screen.getByTestId('generate-playbook'));

    await waitFor(() =>
      expect(mockCreatePlaybook).toHaveBeenCalledWith('goose-hub-self', { windowSize: 10 }),
    );
    await waitFor(() => expect(mockFetchPlaybooks).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Created playbook #42 from 10 lifecycles.')).toBeTruthy();
  });

  it('generates a date range playbook by default', async () => {
    const user = userEvent.setup();

    renderPlaybooksTab();
    await user.click(screen.getByTestId('generate-playbook'));

    await waitFor(() => expect(mockCreatePlaybook).toHaveBeenCalledTimes(1));
    const [, body] = mockCreatePlaybook.mock.calls[0] ?? [];
    expect(body).toHaveProperty('dateRange');
    if (body == null || !('dateRange' in body) || body.dateRange == null) {
      throw new Error('expected dateRange body');
    }
    const { dateRange } = body;
    const start = new Date(dateRange.startAt).getTime();
    const end = new Date(dateRange.endAt).getTime();
    expect(end - start).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
