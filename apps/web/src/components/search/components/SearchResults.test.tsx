/** @vitest-environment jsdom */
import type { SearchResultDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchSearch } = vi.hoisted(() => ({
  mockFetchSearch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  fetchSearch: mockFetchSearch,
}));

import { SearchResults } from './SearchResults';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function withResult(over: Partial<SearchResultDto> = {}): SearchResultDto {
  return {
    items: [],
    events: [],
    total: 0,
    totalEvents: 0,
    hasMore: false,
    ...over,
  };
}

describe('SearchResults', () => {
  it('renders the idle hint when the query is empty and there are no recents', () => {
    render(
      <Providers>
        <SearchResults query="" onSelect={() => {}} />
      </Providers>,
    );
    expect(screen.getByTestId('search-body').textContent).toContain('Start typing');
    expect(mockFetchSearch).not.toHaveBeenCalled();
  });

  it('renders the recents list when query is empty and recents are provided', () => {
    const onPick = vi.fn();
    render(
      <Providers>
        <SearchResults
          query=""
          recents={['cache layer', 'tier-2 results']}
          onPickRecent={onPick}
          onSelect={() => {}}
        />
      </Providers>,
    );
    const rows = screen.getAllByTestId('search-recent-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    expect(onPick).toHaveBeenCalledWith('cache layer');
  });

  it('renders a Show more button when hasMore and bumps the page size on click', async () => {
    mockFetchSearch.mockImplementation((_q: string, opts: { limit?: number }) =>
      Promise.resolve(
        withResult({
          items: Array.from({ length: opts?.limit ?? 0 }, (_, i) => ({
            projectSlug: 'p',
            externalId: String(i + 1),
            title: `cache hit ${i + 1}`,
            state: 'factory:triaging',
            type: 'feature',
            priority: 'medium',
            milestoneTitle: null,
            repoRef: 'r',
            confidence: 100 - i,
          })),
          total: 80,
          hasMore: (opts?.limit ?? 0) < 80,
        }),
      ),
    );
    render(
      <Providers>
        <SearchResults query="cache" onSelect={() => {}} />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('search-show-more')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('search-show-more'));
    await waitFor(() => {
      const rows = screen.getAllByTestId('search-result-row');
      expect(rows.length).toBe(50);
    });
  });

  it('renders skeleton rows while loading', () => {
    mockFetchSearch.mockReturnValue(new Promise(() => {}));
    render(
      <Providers>
        <SearchResults query="cache" onSelect={() => {}} />
      </Providers>,
    );
    const skeletons = screen.getAllByTestId('search-skeleton-row');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders an error state with a retry button when the fetch rejects', async () => {
    mockFetchSearch.mockRejectedValue(new Error('boom'));
    render(
      <Providers>
        <SearchResults query="cache" onSelect={() => {}} />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('search-error')).toBeTruthy();
    });
    expect(screen.getByTestId('search-retry')).toBeTruthy();
  });

  it('renders an empty state when there are no hits', async () => {
    mockFetchSearch.mockResolvedValue(withResult());
    render(
      <Providers>
        <SearchResults query="zzz" onSelect={() => {}} />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('search-empty')).toBeTruthy();
    });
  });

  it('arrow keys move the selected row and Enter triggers onSelect', async () => {
    mockFetchSearch.mockResolvedValue(
      withResult({
        items: [
          {
            projectSlug: 'p',
            externalId: '1',
            title: 'first',
            state: 's',
            type: 'feature',
            priority: 'medium',
            milestoneTitle: null,
            repoRef: 'r',
            confidence: 100,
          },
          {
            projectSlug: 'p',
            externalId: '2',
            title: 'second',
            state: 's',
            type: 'feature',
            priority: 'medium',
            milestoneTitle: null,
            repoRef: 'r',
            confidence: 80,
          },
        ],
        total: 2,
      }),
    );
    const onSelect = vi.fn();
    render(
      <Providers>
        <SearchResults query="x" onSelect={onSelect} />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('search-result-row').length).toBe(2);
    });
    const rows = screen.getAllByTestId('search-result-row');
    expect(rows[0].getAttribute('data-selected')).toBe('true');
    expect(rows[1].getAttribute('data-selected')).toBe('false');

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    await waitFor(() => {
      const after = screen.getAllByTestId('search-result-row');
      expect(after[1].getAttribute('data-selected')).toBe('true');
    });

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '2' }),
      expect.objectContaining({ newTab: false }),
    );
  });

  it('renders a row per hit, with confidence pill, and calls onSelect on click', async () => {
    mockFetchSearch.mockResolvedValue(
      withResult({
        items: [
          {
            projectSlug: 'goose-hub-self',
            externalId: '42',
            title: 'cache layer for tier-2 results',
            state: 'factory:triaging',
            type: 'feature',
            priority: 'medium',
            milestoneTitle: 'M19',
            repoRef: 'shaunnez/goose-hub',
            confidence: 100,
          },
          {
            projectSlug: 'goose-hub-self',
            externalId: '17',
            title: 'older cache fix',
            state: 'factory:done',
            type: 'bug',
            priority: 'low',
            milestoneTitle: null,
            repoRef: 'shaunnez/goose-hub',
            confidence: 64,
          },
        ],
        total: 2,
      }),
    );
    const onSelect = vi.fn();
    render(
      <Providers>
        <SearchResults query="cache" onSelect={onSelect} />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('search-results')).toBeTruthy();
    });
    const rows = screen.getAllByTestId('search-result-row');
    expect(rows).toHaveLength(2);

    const pills = screen.getAllByTestId('search-confidence');
    expect(pills[0].textContent).toBe('100');
    expect(pills[1].textContent).toBe('64');

    fireEvent.click(rows[0]);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ projectSlug: 'goose-hub-self', externalId: '42' }),
      expect.objectContaining({ newTab: false }),
    );
  });

  it('renders the events section when the server returns matching decisions', async () => {
    mockFetchSearch.mockResolvedValue(
      withResult({
        events: [
          {
            eventId: 9001,
            projectSlug: 'goose-hub-self',
            workItemExternalId: '42',
            eventKind: 'agent.decision-summary',
            decisionKind: 'QUERY_PIVOT',
            summary: 'Pivoted to caching tier-2 lookups',
            createdAt: '2026-05-17T10:00:00Z',
            confidence: 100,
          },
        ],
        totalEvents: 1,
      }),
    );
    const onSelectEvent = vi.fn();
    render(
      <Providers>
        <SearchResults query="cache" onSelect={() => {}} onSelectEvent={onSelectEvent} />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('search-event-results')).toBeTruthy();
    });
    const eventRow = screen.getByTestId('search-event-row');
    expect(eventRow.textContent).toContain('Pivoted to caching tier-2 lookups');
    expect(eventRow.textContent).toContain('QUERY_PIVOT');
    fireEvent.click(eventRow);
    expect(onSelectEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 9001, workItemExternalId: '42' }),
      expect.any(Object),
    );
  });

  it('shows only the events section when work items are empty but events match', async () => {
    mockFetchSearch.mockResolvedValue(
      withResult({
        events: [
          {
            eventId: 9002,
            projectSlug: 'goose-hub-self',
            workItemExternalId: null,
            eventKind: 'agent.decision-summary',
            decisionKind: 'PLAN',
            summary: 'Orphan decision summary',
            createdAt: '2026-05-17T10:00:00Z',
            confidence: 100,
          },
        ],
        totalEvents: 1,
      }),
    );
    render(
      <Providers>
        <SearchResults query="orphan" onSelect={() => {}} />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('search-event-results')).toBeTruthy();
    });
    expect(screen.queryByTestId('search-results')).toBeNull();
    expect(screen.queryByTestId('search-empty')).toBeNull();
  });
});
