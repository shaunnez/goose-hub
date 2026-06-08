import { fetchIssueCosts, fetchIssues, fetchProjectConfigs } from '@/lib/api';
import type { ProjectConfigDto, WorkItemCostsDto, WorkItemDto } from '@/lib/types';
import { LaneVisibilityProvider } from '@/state/lane-visibility';
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllProjectsBoard } from './AllProjectsBoard';

vi.mock('@/lib/usePersonaMap', () => ({
  usePersonaMap: () => ({}),
  getPersonaInitials: () => null,
  getPersonaLabel: () => null,
}));

vi.mock('@/lib/api', () => ({
  fetchIssueCosts: vi.fn(),
  fetchIssues: vi.fn(),
  fetchProjectConfigs: vi.fn(),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, EventListener[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(kind: string, listener: EventListener) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }

  removeEventListener(kind: string, listener: EventListener) {
    this.listeners.set(
      kind,
      (this.listeners.get(kind) ?? []).filter((entry) => entry !== listener),
    );
  }

  close = vi.fn();

  emit(kind: string, data: unknown) {
    const msg = new MessageEvent(kind, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(kind) ?? []) listener(msg);
  }
}

function makeProject(slug: string, colorStripe: string): ProjectConfigDto {
  return {
    slug,
    name: slug,
    source: { kind: 'local-db' },
    targetRepo: { cloneUrl: '', defaultBranch: 'main', localPath: '' },
    stack: {
      runtime: 'node',
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
    },
    activeMilestone: null,
    colorStripe,
    budgets: { perWorkflowMaxUsd: 1, dailyTokens: 1, perAdvisorMaxUsd: 1 },
    mode: 'supervised',
    storage: { path: '' },
    isolation: { mode: 'worktree' },
  };
}

function makeItem(projectSlug: string, title: string, state: string): WorkItemDto {
  return {
    id: `local:${projectSlug}#42`,
    canonicalWorkItemId: `local:${projectSlug}#42`,
    externalId: '42',
    repoRef: `${projectSlug}/repo`,
    title,
    body: '',
    type: 'bug',
    priority: 'medium',
    mode: 'supervised',
    state,
    authorIsOwner: true,
    schedule: 'serial',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    externalRefs: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function costsResponse(): WorkItemCostsDto {
  return { workItemId: 'local:proj#42', totalUsd: 0, hasEstimated: false, rows: [] };
}

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LaneVisibilityProvider>
          <AllProjectsBoard />
        </LaneVisibilityProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('AllProjectsBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.mocked(fetchIssueCosts).mockResolvedValue(costsResponse());
    vi.mocked(fetchProjectConfigs).mockResolvedValue([
      makeProject('proj-a', '#f00'),
      makeProject('proj-b', '#0f0'),
    ]);
    vi.mocked(fetchIssues).mockImplementation((slug: string) =>
      Promise.resolve([
        slug === 'proj-a'
          ? makeItem('proj-a', 'Project A same number', 'factory:triaging')
          : makeItem('proj-b', 'Project B same number', 'factory:triaging'),
      ]),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('applies all-project SSE transitions to the matching issues-all project cache only', async () => {
    renderBoard();

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    await waitFor(() => {
      const triageLane = screen.getByTestId('lane-triage');
      expect(within(triageLane).getByText('Project A same number')).toBeTruthy();
      expect(within(triageLane).getByText('Project B same number')).toBeTruthy();
    });

    act(() => {
      MockEventSource.instances[0]?.emit('state.transitioned', {
        projectId: 'proj-b',
        workItemId: 'local:proj-b#42',
        kind: 'state.transitioned',
        payload: { from: 'factory:triaging', to: 'factory:dev-ready' },
      });
    });

    await waitFor(() => {
      expect(
        within(screen.getByTestId('lane-triage')).getByText('Project A same number'),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('lane-dev')).getByText('Project B same number'),
      ).toBeTruthy();
    });
    expect(screen.getByTestId('lane-triage').textContent).not.toContain('Project B same number');
  });

  it('invalidates all issues-all project queries after an SSE reconnect', async () => {
    const client = renderBoard();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      MockEventSource.instances[0]?.onerror?.();
      MockEventSource.instances[0]?.onopen?.();
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issues-all', 'proj-a'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issues-all', 'proj-b'] });
    });
  });
});
