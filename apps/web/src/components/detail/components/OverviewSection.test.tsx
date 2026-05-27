/** @vitest-environment jsdom */
import { fetchEvents, fetchIssueDiff, fetchTriageResult } from '@/lib/api';
import type { AgentEventDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewSection } from './OverviewSection';

const useParamsMock = vi.fn();
const buildOverviewWorkflowCardsMock = vi.fn();
const useIssueCostsBreakdownMock = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  fetchIssueDiff: vi.fn(),
  fetchTriageResult: vi.fn(),
}));

vi.mock('@/lib/markdown', () => ({
  renderMarkdownToHtml: vi.fn(() => '<p>Brief body</p>'),
}));

vi.mock('@/lib/usePersonaMap', () => ({
  usePersonaMap: vi.fn(() => ({})),
  getPersonaLabel: vi.fn(() => 'Rogue Pinion (GRL)'),
  getPersonaInitials: vi.fn(() => 'RP'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => useParamsMock(),
  };
});

vi.mock('../lib/costs', () => ({
  useIssueCostsBreakdown: () => useIssueCostsBreakdownMock(),
}));

vi.mock('../lib/overview-workflow-summary', () => ({
  buildOverviewWorkflowCards: (...args: unknown[]) => buildOverviewWorkflowCardsMock(...args),
}));

vi.mock('./CommentsSection', () => ({
  CommentsSection: () => <div data-testid="comments-section" />,
}));

vi.mock('./DependenciesSection', () => ({
  DependenciesSection: () => <div data-testid="dependencies-section" />,
}));

afterEach(cleanup);

const ITEM: WorkItemDto = {
  id: 'github:test/repo#42',
  externalId: '42',
  repoRef: 'test/repo',
  title: 'Workflow snapshot',
  body: 'Brief body',
  type: 'feature',
  priority: 'medium',
  mode: 'default',
  state: 'factory:prd-review',
  authorIsOwner: false,
  schedule: 'normal',
  exec: 'serial',
  dependsOn: [],
  blocks: [],
  createdAt: '2026-05-27T00:00:00Z',
  lastPersonaId: 'persona-1',
};

const TRIAGE: TriageResultDto = {
  priority: 'high',
  type: 'feature',
  candidates: [{ repo: 'shaunnez/goose-hub', confidence: 85, evidence: 'match', tier: 1 }],
  overrideRepo: null,
};

const EVENTS: AgentEventDto[] = [
  {
    id: 1,
    projectId: 'proj',
    workItemId: ITEM.id,
    kind: 'review.completed',
    payload: { verdict: 'approved', confidence: 0.91, criteriaChecks: [], findings: [] },
    createdAt: '2026-05-27T00:00:01Z',
  },
];

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSection() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <OverviewSection item={ITEM} projectSlug="proj" />
    </QueryClientProvider>,
  );
}

describe('OverviewSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useParamsMock.mockReturnValue({ slug: 'proj', id: '42' });
    vi.mocked(fetchEvents).mockResolvedValue(EVENTS);
    vi.mocked(fetchIssueDiff).mockResolvedValue({ diff: null, runId: null });
    vi.mocked(fetchTriageResult).mockResolvedValue(TRIAGE);
    useIssueCostsBreakdownMock.mockReturnValue({
      byRun: new Map(),
      byStage: new Map(),
      bySkill: new Map(),
      total: 0,
      totalTokens: 0,
      hasEstimated: false,
      totalLabel: 'exact',
      runCount: 0,
      isLoading: false,
    });
    buildOverviewWorkflowCardsMock.mockReturnValue([
      {
        key: 'triage',
        title: 'Triage',
        status: 'Complete',
        statusTone: 'success',
        metrics: [
          { label: 'Priority', value: 'high' },
          { label: 'Repo', value: 'shaunnez/goose-hub' },
        ],
        hrefSection: 'triage',
      },
      {
        key: 'review',
        title: 'Review',
        status: 'Approved',
        statusTone: 'success',
        metrics: [{ label: 'Confidence', value: '91%' }],
      },
    ]);
  });

  it('renders the workflow snapshot grid with readable labels from partial data', async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('Workflow Snapshot')).toBeTruthy();
    });

    expect(screen.getByText('Triage')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Priority')).toBeTruthy();
    expect(screen.getByText('shaunnez/goose-hub')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('queries canonical triage data and passes overview inputs into the summary builder', async () => {
    renderSection();

    await waitFor(() => {
      expect(fetchTriageResult).toHaveBeenCalledWith('proj', '42');
    });

    await waitFor(() => {
      expect(buildOverviewWorkflowCardsMock).toHaveBeenLastCalledWith({
        item: ITEM,
        events: EVENTS,
        costs: expect.objectContaining({ byStage: expect.any(Map), bySkill: expect.any(Map) }),
        diff: { diff: null, runId: null },
        triage: TRIAGE,
      });
    });
  });

  it('uses the responsive 1/2/3-column grid classes for the workflow cards', async () => {
    const { container } = renderSection();

    await waitFor(() => {
      expect(screen.getByText('Workflow Snapshot')).toBeTruthy();
    });
    const grid = container.querySelector('[data-testid="workflow-snapshot-grid"]');
    expect(grid?.className).toContain('grid-cols-1');
    expect(grid?.className).toContain('md:grid-cols-2');
    expect(grid?.className).toContain('xl:grid-cols-3');
  });
});
