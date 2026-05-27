/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPage } from './DetailPage';

const { fetchIssue, fetchIssues, fetchEventsPage } = vi.hoisted(() => ({
  fetchIssue: vi.fn(),
  fetchIssues: vi.fn(),
  fetchEventsPage: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  fetchIssue,
  fetchIssues,
  fetchEventsPage,
}));

vi.mock('@/state/active-milestone', () => ({
  useActiveMilestone: () => ({ activeNumber: null }),
}));

vi.mock('@/lib/project-budget', () => ({
  useProjectBudgetStatus: () => ({ data: null }),
}));

vi.mock('@/components/ui/ProjectBudgetBanner', () => ({
  ProjectBudgetBanner: () => null,
}));

vi.mock('../lib/useHasOpenDep', () => ({
  useHasOpenDep: () => false,
}));

vi.mock('./TaskHeader', () => ({
  TaskHeader: ({ item }: { item?: { id: string } }) => (
    <div data-testid="task-header">{item?.id}</div>
  ),
}));
vi.mock('./GatePendingBanner', () => ({ GatePendingBanner: () => null }));
vi.mock('./PendingNextRunBanner', () => ({ PendingNextRunBanner: () => null }));
vi.mock('./ApprovalGateSection', () => ({ ApprovalGateSection: () => null }));
vi.mock('./LeftRail', () => ({ LeftRail: () => null }));
vi.mock('./OverviewSection', () => ({ OverviewSection: () => <div data-testid="overview" /> }));
vi.mock('./TriageResultsSection', () => ({ TriageResultsSection: () => null }));
vi.mock('./TimelineSection', () => ({ TimelineSection: () => null }));
vi.mock('./InvestigationSection', () => ({ InvestigationSection: () => null }));
vi.mock('./PRDSection', () => ({ PRDSection: () => null }));
vi.mock('./GrillSection', () => ({ GrillSection: () => null }));
vi.mock('./CodeDiffSection', () => ({ CodeDiffSection: () => null }));
vi.mock('./QASection', () => ({ QASection: () => null }));
vi.mock('./ReviewSection', () => ({ ReviewSection: () => null }));
vi.mock('./RetrospectiveSection', () => ({ RetrospectiveSection: () => null }));
vi.mock('./CostsSection', () => ({ CostsSection: () => null }));
vi.mock('./DeferredSurface', () => ({ DeferredSurface: () => null }));

class MockEventSource {
  static urls: string[] = [];

  constructor(url: string) {
    MockEventSource.urls.push(url);
  }

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

function renderDetailPage(path = '/projects/proj/items/1') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:slug/items/:id" element={<DetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.urls = [];
    vi.stubGlobal('EventSource', MockEventSource);
    fetchEventsPage.mockResolvedValue({ events: [], hasMore: false });
    fetchIssues.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('subscribes local-db detail pages with the canonical local Work Item id', async () => {
    fetchIssue.mockResolvedValue({
      id: 'local:proj#1',
      canonicalWorkItemId: 'local:proj#1',
      externalId: '1',
      repoRef: 'owner/repo',
      title: 'Local item',
      body: '',
      type: 'feature',
      priority: 'medium',
      mode: 'supervised',
      state: 'factory:triaging',
      authorIsOwner: true,
      schedule: 'current',
      exec: 'serial',
      dependsOn: [],
      blocks: [],
      createdAt: '2026-05-27T00:00:00Z',
      externalRefs: [],
    });

    renderDetailPage();

    await waitFor(() => expect(MockEventSource.urls).toHaveLength(1));
    const url = new URL(MockEventSource.urls[0], 'http://localhost');
    expect(url.searchParams.get('workItemId')).toBe('local:proj#1');
  });
});
