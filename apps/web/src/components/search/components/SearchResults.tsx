import { fetchSearch } from '@/lib/api';
import type { SearchHitDto, SearchResultDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

interface SearchResultsProps {
  query: string;
  onSelect: (hit: SearchHitDto) => void;
}

export function SearchResults({ query, onSelect }: SearchResultsProps) {
  const trimmed = query.trim();
  const enabled = trimmed.length > 0;

  const { data, isLoading, isError, refetch } = useQuery<SearchResultDto>({
    queryKey: ['search', trimmed],
    queryFn: ({ signal }) => fetchSearch(trimmed, { signal }),
    enabled,
    staleTime: 30_000,
  });

  if (!enabled) {
    return (
      <div data-testid="search-body" className="px-4 py-10 min-h-[200px]">
        <p className="text-[12.5px] text-fg-3 text-center">
          Start typing to search work items across all projects.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div data-testid="search-body" className="px-4 py-3 min-h-[200px]">
        <ul className="flex flex-col gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <li
              key={i}
              data-testid="search-skeleton-row"
              className="h-9 rounded-md bg-bg-hover/50 animate-pulse"
            />
          ))}
        </ul>
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="search-body" className="px-4 py-10 min-h-[200px]">
        <p data-testid="search-error" className="text-[12.5px] text-fg-2 text-center mb-2">
          Could not load search results.
        </p>
        <div className="flex justify-center">
          <button
            type="button"
            data-testid="search-retry"
            onClick={() => {
              void refetch();
            }}
            className="h-7 px-3 rounded-md text-[12px] text-fg-2 border border-line bg-bg hover:bg-bg-elev cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div data-testid="search-body" className="px-4 py-10 min-h-[200px]">
        <p data-testid="search-empty" className="text-[12.5px] text-fg-3 text-center">
          Nothing matched. Try a different query or remove a filter.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="search-body" className="min-h-[200px] max-h-[55vh] overflow-y-auto">
      <div className="px-4 pt-3 pb-1.5 text-[10.5px] uppercase tracking-wider text-fg-3">
        Work items · {data?.total ?? items.length}
      </div>
      <ul data-testid="search-results" className="flex flex-col">
        {items.map((hit) => (
          <li key={`${hit.projectSlug}#${hit.externalId}`}>
            <button
              type="button"
              data-testid="search-result-row"
              onClick={() => onSelect(hit)}
              className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-bg-hover focus:bg-bg-hover focus:outline-none cursor-pointer"
            >
              <span className="font-mono text-[11.5px] text-fg-3 w-12 shrink-0">
                #{hit.externalId}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[13px] text-fg">{hit.title}</span>
                <span className="block truncate text-[11px] text-fg-3">
                  {hit.state} · {hit.type}
                  {hit.milestoneTitle != null ? ` · ${hit.milestoneTitle}` : ''} · {hit.repoRef}
                </span>
              </span>
              <ConfidencePill value={hit.confidence} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const tone =
    value >= 80
      ? 'text-success border-success/40'
      : value >= 50
        ? 'text-fg-2 border-line-2'
        : 'text-fg-3 border-line';
  return (
    <span
      data-testid="search-confidence"
      className={`shrink-0 tnum mono text-[10.5px] px-1.5 py-0.5 rounded border ${tone}`}
    >
      {value}
    </span>
  );
}
