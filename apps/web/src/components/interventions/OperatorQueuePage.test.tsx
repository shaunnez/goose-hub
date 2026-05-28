/** @vitest-environment jsdom */
import {
  decideIntervention,
  fetchIssues,
  fetchProjectConfigs,
  fetchProjectInterventions,
} from '@/lib/api';
import type { ProjectConfigDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperatorQueuePage } from './OperatorQueuePage';

vi.mock('@/lib/api', () => ({
  decideIntervention: vi.fn(),
  fetchIssues: vi.fn(),
  fetchProjectConfigs: vi.fn(),
  fetchProjectInterventions: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <OperatorQueuePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function makeProjectConfig(): ProjectConfigDto {
  return {
    slug: 'proj-a',
    name: 'Proj A',
    source: { kind: 'github', repo: 'owner/repo' },
    targetRepo: {
      cloneUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
      localPath: '/tmp/owner-repo',
    },
    stack: {
      runtime: 'node',
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
    },
    activeMilestone: null,
    colorStripe: '#f00',
    budgets: { perWorkflowMaxUsd: 1, dailyTokens: 100, perAdvisorMaxUsd: 1 },
    mode: 'supervised',
    storage: { path: '/tmp/factory.db' },
    isolation: { mode: 'worktree' },
  };
}

describe('OperatorQueuePage', () => {
  it('groups interventions by project and type', async () => {
    vi.mocked(fetchProjectConfigs).mockResolvedValue([makeProjectConfig()]);
    vi.mocked(fetchIssues).mockResolvedValue([
      {
        id: 'github:owner/repo#42',
        canonicalWorkItemId: 'github:owner/repo#42',
        externalId: '42',
        repoRef: 'owner/repo',
        title: 'Fix stuck issue',
        body: '',
        type: 'bug',
        priority: 'high',
        mode: 'supervised',
        state: 'factory:needs-human',
        authorIsOwner: true,
        schedule: 'current',
        exec: 'serial',
        dependsOn: [],
        blocks: [],
        externalRefs: [],
        createdAt: '2026-05-20T00:00:00Z',
      },
    ]);
    vi.mocked(fetchProjectInterventions).mockResolvedValue([
      {
        id: 'i1',
        projectId: 'proj-a',
        workItemId: 'github:owner/repo#42',
        interventionType: 'needs_human',
        status: 'OPEN',
        title: 'Issue moved to needs-human',
        reason: 'The lifecycle state requires operator intervention.',
        rootCauseSignature: 'sig',
        correlationId: 'c1',
        sourceEventId: 1,
        proposedOptions: [],
        decidedActionType: null,
        decidedActionPayload: null,
        decidedBy: null,
        decisionReason: null,
        applicationResult: null,
        verification: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: 0,
        createdAt: '2026-05-20T00:00:00Z',
        updatedAt: '2026-05-20T00:00:00Z',
        resolvedAt: null,
      },
    ]);

    renderPage();

    expect(await screen.findAllByText('proj-a')).toHaveLength(2);
    expect(screen.getAllByText('Needs Human')).toHaveLength(2);
    expect(screen.getByText('Fix stuck issue')).toBeTruthy();
    expect(screen.getByText('Proposal pending')).toBeTruthy();
  });

  it('submits proposed decisions with the row version', async () => {
    vi.mocked(fetchProjectConfigs).mockResolvedValue([makeProjectConfig()]);
    vi.mocked(fetchIssues).mockResolvedValue([]);
    vi.mocked(fetchProjectInterventions).mockResolvedValue([
      {
        id: 'i1',
        projectId: 'proj-a',
        workItemId: 'github:owner/repo#42',
        interventionType: 'needs_human',
        status: 'PROPOSED',
        title: 'Issue moved to needs-human',
        reason: 'The lifecycle state requires operator intervention.',
        rootCauseSignature: 'sig',
        correlationId: 'c1',
        sourceEventId: 1,
        proposedOptions: [
          {
            actionType: 'no_action',
            label: 'Wait',
            description: 'Leave it open.',
            payload: { reason: 'wait' },
            risk: 'low',
          },
        ],
        decidedActionType: null,
        decidedActionPayload: null,
        decidedBy: null,
        decisionReason: null,
        applicationResult: null,
        verification: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: 7,
        createdAt: '2026-05-20T00:00:00Z',
        updatedAt: '2026-05-20T00:00:00Z',
        resolvedAt: null,
      },
    ]);
    vi.mocked(decideIntervention).mockResolvedValue({
      intervention: {} as never,
      events: [],
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Wait' }));

    await waitFor(() => {
      expect(decideIntervention).toHaveBeenCalledWith('i1', {
        actionType: 'no_action',
        actionPayload: { reason: 'wait' },
        expectedVersion: 7,
        decidedBy: 'operator',
      });
    });
  });

  it('retries downstream queue queries from the error state', async () => {
    vi.mocked(fetchProjectConfigs).mockResolvedValue([makeProjectConfig()]);
    vi.mocked(fetchIssues).mockResolvedValue([]);
    vi.mocked(fetchProjectInterventions)
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce([]);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(fetchProjectInterventions).toHaveBeenCalledTimes(2);
    });
    expect(fetchIssues).toHaveBeenCalledTimes(2);
  });
});
