/** @vitest-environment jsdom */
import { fetchIssueCosts, fetchMilestones } from '@/lib/api';
import type { AgentEventDto, WorkItemCostsDto, WorkItemDto } from '@/lib/types';
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

function event(id: number, kind: string, createdAt: string, payload: unknown = {}): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    kind,
    payload,
    runId: `run-${id}`,
    createdAt,
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

  it('renders cost, token, cache, and pipeline fix duration metrics', async () => {
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

    renderWithQueryClient(
      <TaskHeader
        item={item()}
        projectSlug="proj"
        events={[
          event(1, 'agent.run-started', '2026-05-01T00:00:00Z', { skill: 'triage' }),
          event(2, 'agent.run-started', '2026-05-01T00:02:00Z', { skill: 'investigate' }),
          event(3, 'review.completed', '2026-05-01T00:17:11Z'),
          event(4, 'retrospective.completed', '2026-05-01T02:15:00Z'),
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('task-header-cost').textContent).toContain('cost $0.42');
    });
    expect(screen.getByTestId('task-header-tokens').textContent).toContain('tokens 1.5k');
    expect(screen.getByTestId('task-header-cached-tokens').textContent).toContain('cached 600');
    expect(screen.getByTestId('task-header-cache-hit').textContent).toContain('cache hit 50%');
    expect(screen.getByTestId('task-header-fix-duration').textContent).toContain(
      'fix duration 17m',
    );
  });

  it('does not derive fix duration from work item age or closedAt', async () => {
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
          pipelineStartedAt: '2026-05-01T00:10:00Z',
          pipelineCompletedAt: '2026-05-01T00:27:00Z',
        })}
        projectSlug="proj"
        events={[event(4, 'retrospective.completed', '2026-05-01T02:15:00Z')]}
      />,
    );

    expect(screen.getByTestId('task-header-fix-duration').textContent).toContain(
      'fix duration 17m',
    );
  });

  it('keeps fix duration live during rework after a needs-fix review', async () => {
    vi.mocked(fetchIssueCosts).mockResolvedValue({
      workItemId: 'wi-1',
      totalUsd: 0,
      hasEstimated: false,
      rows: [],
    });

    renderWithQueryClient(
      <TaskHeader
        item={item()}
        projectSlug="proj"
        events={[
          event(1, 'agent.run-started', '2026-05-01T00:00:00Z', { skill: 'triage' }),
          event(2, 'review.completed', '2026-05-01T00:17:00Z', { verdict: 'needs-fix' }),
          event(3, 'agent.run-started', '2026-05-01T00:20:00Z', { skill: 'implement' }),
        ]}
      />,
    );

    // Date.now() mocked to 2026-05-01T02:15:00Z → 2h 15m since first run started
    expect(screen.getByTestId('task-header-fix-duration').textContent).toContain(
      'fix duration 2h 15m',
    );
  });

  it('freezes fix duration at agent.run-failed for failed pipelines', async () => {
    vi.mocked(fetchIssueCosts).mockResolvedValue({
      workItemId: 'wi-1',
      totalUsd: 0,
      hasEstimated: false,
      rows: [],
    });

    renderWithQueryClient(
      <TaskHeader
        item={item()}
        projectSlug="proj"
        events={[
          event(1, 'agent.run-started', '2026-05-01T00:00:00Z', { skill: 'triage' }),
          event(2, 'agent.run-failed', '2026-05-01T00:10:00Z', { error: 'timeout' }),
        ]}
      />,
    );

    expect(screen.getByTestId('task-header-fix-duration').textContent).toContain('fix duration 10m');
  });

  it('shows an empty fix duration before the agent pipeline starts', async () => {
    vi.mocked(fetchIssueCosts).mockResolvedValue({
      workItemId: 'wi-1',
      totalUsd: 0,
      hasEstimated: false,
      rows: [],
    });

    renderWithQueryClient(<TaskHeader item={item()} projectSlug="proj" events={[]} />);

    expect(screen.getByTestId('task-header-fix-duration').textContent).toContain('fix duration —');
  });
});
