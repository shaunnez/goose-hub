import { fetchIssueCosts } from '@/lib/api';
import type { WorkItemCostsDto, WorkItemDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueCard } from './IssueCard';

vi.mock('@/lib/usePersonaMap', () => ({
  usePersonaMap: () => ({}),
  getPersonaInitials: () => null,
  getPersonaLabel: () => null,
}));

vi.mock('@/lib/api', () => ({
  fetchIssueCosts: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(fetchIssueCosts).mockReset();
});

const BASE_ITEM: WorkItemDto = {
  id: 'github:shaunnez/goose-hub#42',
  canonicalWorkItemId: 'github:shaunnez/goose-hub#42',
  externalId: '42',
  repoRef: 'shaunnez/goose-hub',
  title: 'Fix the login bug',
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
  externalRefs: [
    {
      id: 1,
      provider: 'github',
      kind: 'issue',
      repoRef: 'shaunnez/goose-hub',
      externalId: '42',
      url: 'https://github.com/shaunnez/goose-hub/issues/42',
      metadata: null,
      createdAt: new Date().toISOString(),
    },
  ],
  createdAt: new Date(Date.now() - 3600000).toISOString(),
};

function renderCard(item = BASE_ITEM) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IssueCard item={item} projectSlug="goose-hub-self" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function costsResponse(rows: WorkItemCostsDto['rows'], totalUsd = 0): WorkItemCostsDto {
  return { workItemId: 'wi-1', totalUsd, hasEstimated: false, rows };
}

describe('IssueCard', () => {
  it('renders the issue title', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard();
    expect(screen.getByText('Fix the login bug')).toBeTruthy();
  });

  it('renders the issue number', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard();
    expect(screen.getByText('#42')).toBeTruthy();
  });

  it('renders the state label', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard();
    expect(screen.getByText('in-progress')).toBeTruthy();
  });

  it('renders the priority pill', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard();
    // The Pill component renders "high" as text
    const pills = screen.getAllByText('high');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('renders "$—" when there are no cost rows yet', async () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard();
    await waitFor(() => {
      expect(screen.getByTestId('issue-card-cost').textContent).toBe('$—');
    });
  });

  it('renders the formatted total cost when rows are present', async () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(
      costsResponse(
        [
          {
            runId: 'r1',
            workItemId: 'wi-1',
            stage: 'dev',
            skill: 'implement',
            modelId: 'claude-sonnet-4-6',
            provider: 'claude' as const,
            inputTokens: 800,
            cachedInputTokens: 0,
            outputTokens: 400,
            reasoningOutputTokens: 0,
            costUsd: 0.42,
            costLabel: 'exact',
            cacheHitRatio: 0,
            personaId: null,
            createdAt: new Date().toISOString(),
          },
        ],
        0.42,
      ),
    );
    renderCard();
    await waitFor(() => {
      expect(screen.getByTestId('issue-card-cost').textContent).toBe('$0.42');
    });
  });

  it('truncates long titles at 55 chars', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    const longTitle = 'A'.repeat(60);
    renderCard({ ...BASE_ITEM, title: longTitle });
    const link = screen.getByRole('link');
    // Title text in the div should be truncated with ellipsis
    expect(link.textContent).toContain('…');
  });

  it('renders a milestone badge when milestoneTitle is set', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({ ...BASE_ITEM, milestoneTitle: 'M10: Multi-project Orchestration' });
    const badge = screen.getByTestId('milestone-badge');
    expect(badge.textContent).toBe('M10: Multi-project Orchestration');
  });

  it('does not render a milestone badge when milestoneTitle is absent', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({ ...BASE_ITEM, milestoneTitle: undefined });
    expect(screen.queryByTestId('milestone-badge')).toBeNull();
  });

  // ─── blocked indicator ───────────────────────────────────────────────────

  it('shows blocked indicator when schedule is blocked-by', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({ ...BASE_ITEM, schedule: 'blocked-by', dependsOn: ['shaunnez/goose-hub#10'] });
    expect(screen.getByTestId('blocked-indicator')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('does not show blocked indicator when schedule is current', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({ ...BASE_ITEM, schedule: 'current' });
    expect(screen.queryByTestId('blocked-indicator')).toBeNull();
  });

  it('shows local-only when no external refs are linked', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({
      ...BASE_ITEM,
      id: 'local:proj#1',
      canonicalWorkItemId: 'local:proj#1',
      externalId: '1',
      externalRefs: [],
    });
    expect(screen.getByTestId('local-only-indicator')).toBeTruthy();
    expect(screen.getByText('Local-only')).toBeTruthy();
  });

  it('does not show local-only for GitHub Work Items with normalized empty refs', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({ ...BASE_ITEM, externalRefs: [] });

    expect(screen.queryByTestId('local-only-indicator')).toBeNull();
  });

  it('blocked indicator tooltip lists same-repo dep as short ref', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({
      ...BASE_ITEM,
      schedule: 'blocked-by',
      repoRef: 'shaunnez/goose-hub',
      dependsOn: ['shaunnez/goose-hub#10'],
    });
    const indicator = screen.getByTestId('blocked-indicator');
    expect(indicator.getAttribute('title')).toBe('Blocked by: #10');
  });

  it('blocked indicator tooltip lists cross-repo dep in full', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({
      ...BASE_ITEM,
      schedule: 'blocked-by',
      repoRef: 'shaunnez/goose-hub',
      dependsOn: ['other/repo#5'],
    });
    const indicator = screen.getByTestId('blocked-indicator');
    expect(indicator.getAttribute('title')).toBe('Blocked by: other/repo#5');
  });

  it('blocked indicator co-exists with persona chip and cost badge', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    renderCard({
      ...BASE_ITEM,
      schedule: 'blocked-by',
      dependsOn: ['shaunnez/goose-hub#10'],
    });
    expect(screen.getByTestId('blocked-indicator')).toBeTruthy();
    expect(screen.getByTestId('issue-card-cost')).toBeTruthy();
  });

  it('truncates long milestone names to prevent text overflow', () => {
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(costsResponse([]));
    const longMilestone =
      'M99: Very Long Milestone Name That Should Be Truncated With Ellipsis To Prevent Overflow';
    renderCard({ ...BASE_ITEM, milestoneTitle: longMilestone });
    const badge = screen.getByTestId('milestone-badge');
    // Verify the badge has truncate class applied (via classList check for text-ellipsis)
    const hasEllipsisStyling =
      badge.className.includes('truncate') || window.getComputedStyle(badge).overflow === 'hidden';
    expect(hasEllipsisStyling).toBe(true);
    // Verify text content is still present (not deleted)
    expect(badge.textContent).toBe(longMilestone);
  });
});
