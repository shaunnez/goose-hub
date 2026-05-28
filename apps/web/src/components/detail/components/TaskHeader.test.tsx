/** @vitest-environment jsdom */
import { fetchIssueCosts, fetchMilestones } from '@/lib/api';
import type { WorkItemCostsDto, WorkItemDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskHeader } from './TaskHeader';

vi.mock('@/lib/api', () => ({
  fetchIssueCosts: vi.fn(),
  fetchMilestones: vi.fn(),
  fetchPersonaNames: vi.fn().mockResolvedValue([]),
  fetchLegalTargets: vi.fn().mockResolvedValue({ from: 'factory:in-progress', legalTargets: [] }),
  setLabel: vi.fn(),
  setMilestone: vi.fn(),
  transitionState: vi.fn(),
}));

vi.mock('./TransitionButton', () => ({
  TransitionButton: () => <button type="button">Transition</button>,
}));

let dateNowSpy: ReturnType<typeof vi.spyOn>;

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function item(partial: Partial<WorkItemDto> = {}): WorkItemDto {
  return {
    id: 'wi-1',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Fix task header metrics',
    body: '',
    type: 'bug',
    priority: 'high',
    mode: 'supervised',
    state: 'factory:in-progress',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: '2026-05-01T00:00:00Z',
    ...partial,
  };
}

describe('TaskHeader', () => {
  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-01T02:15:00Z').getTime());
    vi.mocked(fetchMilestones).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    dateNowSpy.mockRestore();
    vi.mocked(fetchIssueCosts).mockReset();
    vi.mocked(fetchMilestones).mockReset();
  });

  it('renders cost, token, cache, and fix duration metrics', async () => {
    const costs: WorkItemCostsDto = {
      workItemId: 'wi-1',
      totalUsd: 0.42,
      hasEstimated: false,
      rows: [
        {
          runId: 'run-1',
          workItemId: 'wi-1',
          stage: 'dev',
          skill: 'implement',
          modelId: 'claude-sonnet-4-6',
          provider: 'claude',
          inputTokens: 1200,
          cachedInputTokens: 600,
          outputTokens: 300,
          reasoningOutputTokens: 0,
          costUsd: 0.42,
          costLabel: 'exact',
          cacheHitRatio: 0.5,
          personaId: null,
          createdAt: '2026-05-01T01:00:00Z',
        },
      ],
    };
    vi.mocked(fetchIssueCosts).mockResolvedValue(costs);

    renderWithQueryClient(<TaskHeader item={item()} projectSlug="proj" />);

    await waitFor(() => {
      expect(screen.getByTestId('task-header-cost').textContent).toContain('cost $0.42');
    });
    expect(screen.getByTestId('task-header-tokens').textContent).toContain('tokens 1.5k');
    expect(screen.getByTestId('task-header-cached-tokens').textContent).toContain('cached 600');
    expect(screen.getByTestId('task-header-cache-hit').textContent).toContain('cache hit 50%');
    expect(screen.getByTestId('task-header-fix-duration').textContent).toContain(
      'fix duration 2h 15m',
    );
  });

  it('freezes fix duration at closedAt for completed work', async () => {
    vi.mocked(fetchIssueCosts).mockResolvedValue({
      workItemId: 'wi-1',
      totalUsd: 0,
      hasEstimated: false,
      rows: [],
    });

    renderWithQueryClient(
      <TaskHeader
        item={item({
          state: 'factory:done',
          createdAt: '2026-05-01T00:00:00Z',
          closedAt: '2026-05-01T00:45:00Z',
        })}
        projectSlug="proj"
      />,
    );

    expect(screen.getByTestId('task-header-fix-duration').textContent).toContain(
      'fix duration 45m',
    );
  });
});
