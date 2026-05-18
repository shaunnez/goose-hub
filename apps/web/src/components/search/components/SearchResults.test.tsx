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
    total: 0,
    hasMore: false,
    ...over,
  };
}

describe('SearchResults', () => {
  it('renders the idle hint when the query is empty', () => {
    render(
      <Providers>
        <SearchResults query="" onSelect={() => {}} />
      </Providers>,
    );
    expect(screen.getByTestId('search-body').textContent).toContain('Start typing');
    expect(mockFetchSearch).not.toHaveBeenCalled();
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
    );
  });
});
