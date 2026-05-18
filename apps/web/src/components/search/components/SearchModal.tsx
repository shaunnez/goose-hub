import type { SearchClientFilters, SearchTypeFilter } from '@/lib/api';
import type { SearchHitDto } from '@/lib/types';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { SearchResults } from './SearchResults';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

const DEBOUNCE_MS = 200;

const TYPE_CYCLE: ReadonlyArray<SearchTypeFilter | undefined> = [
  undefined,
  'feature',
  'bug',
  'chore',
  'research',
];

interface FilterState {
  scope: 'this' | 'all';
  milestone: 'active' | 'all';
  type: SearchTypeFilter | undefined;
}

const DEFAULT_FILTERS: FilterState = {
  scope: 'this',
  milestone: 'active',
  type: undefined,
};

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const params = useParams<{ slug?: string }>();
  const currentSlug = params.slug;
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setFilters(DEFAULT_FILTERS);
    }
  }, [open]);

  const clientFilters: SearchClientFilters = useMemo(() => {
    const out: SearchClientFilters = {};
    if (filters.scope === 'this' && currentSlug != null) {
      out.projectSlug = currentSlug;
    }
    if (filters.milestone === 'all') out.milestone = 'all';
    if (filters.type != null) out.type = filters.type;
    return out;
  }, [filters, currentSlug]);

  function handleSelect(hit: SearchHitDto) {
    navigate(`/projects/${hit.projectSlug}/items/${hit.externalId}`);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      data-testid="search-modal"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xl flex items-start justify-center pt-[12vh] px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl bg-bg-elev border border-line rounded-lg shadow-lg overflow-hidden"
        aria-label="Search"
      >
        <div className="flex items-center gap-2 px-4 h-12 border-b border-line">
          <Search size={15} className="text-fg-3 shrink-0" />
          <input
            ref={inputRef}
            data-testid="search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search work items across all projects…"
            className="flex-1 bg-transparent outline-none text-fg placeholder:text-fg-3 text-[14px]"
          />
          <button
            type="button"
            data-testid="search-close"
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-fg-3 hover:text-fg cursor-pointer"
            aria-label="Close search"
          >
            <X size={14} />
          </button>
        </div>

        <div
          data-testid="search-filters"
          className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-line bg-bg/40"
        >
          <FilterChip
            testid="search-filter-scope"
            active={filters.scope === 'this' && currentSlug != null}
            disabled={currentSlug == null}
            title={
              currentSlug == null
                ? 'Open a project to enable "This project"'
                : 'Toggle between this project and all projects'
            }
            label={
              currentSlug != null && filters.scope === 'this'
                ? `In: ${currentSlug}`
                : 'All projects'
            }
            onClick={() => {
              if (currentSlug == null) return;
              setFilters((f) => ({ ...f, scope: f.scope === 'this' ? 'all' : 'this' }));
            }}
          />
          <FilterChip
            testid="search-filter-milestone"
            active={filters.milestone === 'active'}
            label={filters.milestone === 'active' ? 'Active milestone' : 'All milestones'}
            title="Toggle between active milestone and all milestones"
            onClick={() =>
              setFilters((f) => ({
                ...f,
                milestone: f.milestone === 'active' ? 'all' : 'active',
              }))
            }
          />
          <FilterChip
            testid="search-filter-type"
            active={filters.type != null}
            label={filters.type ?? 'Any type'}
            title="Cycle through work-item types"
            onClick={() =>
              setFilters((f) => {
                const idx = TYPE_CYCLE.indexOf(f.type);
                const next = TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length];
                return { ...f, type: next };
              })
            }
          />
          <button
            type="button"
            disabled
            title="Open / closed toggle lands in a follow-up PR"
            className="h-6 px-2 rounded-md text-[11.5px] text-fg-3 border border-line bg-bg cursor-not-allowed"
          >
            Open only
          </button>
        </div>

        <SearchResults query={debounced} filters={clientFilters} onSelect={handleSelect} />

        <div className="flex items-center justify-between px-4 h-9 border-t border-line bg-bg/40 text-[11px] text-fg-3">
          <span>
            <kbd className="px-1 py-0.5 mr-1 rounded border border-line bg-bg text-fg-3">↑↓</kbd>
            navigate
            <kbd className="px-1 py-0.5 mx-1 ml-3 rounded border border-line bg-bg text-fg-3">
              ↵
            </kbd>
            open
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded border border-line bg-bg text-fg-3">Esc</kbd>
            <span className="ml-1">close</span>
          </span>
        </div>
      </div>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  testid: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

function FilterChip({ label, active, testid, title, onClick, disabled }: FilterChipProps) {
  const base = 'h-6 px-2 rounded-md text-[11.5px] border';
  const tone = disabled
    ? 'text-fg-3 border-line bg-bg cursor-not-allowed'
    : active
      ? 'text-fg border-accent-line bg-accent-soft cursor-pointer'
      : 'text-fg-2 border-line bg-bg hover:bg-bg-elev cursor-pointer';
  return (
    <button
      type="button"
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`${base} ${tone}`}
    >
      {label}
    </button>
  );
}
