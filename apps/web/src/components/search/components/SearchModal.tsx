import type { SearchHitDto } from '@/lib/types';
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { SearchResults } from './SearchResults';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

// Filter chips remain disabled stubs until PR-4 of #834.
const FILTER_CHIPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'scope', label: 'All projects' },
  { key: 'milestone', label: 'All milestones' },
  { key: 'type', label: 'Any type' },
  { key: 'includeClosed', label: 'Open only' },
];

const DEBOUNCE_MS = 200;

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
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

  // Reset the query each time the modal opens so prior input doesn't bleed
  // into a fresh session.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

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
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              disabled
              title="Filters land in a follow-up PR"
              className="h-6 px-2 rounded-md text-[11.5px] text-fg-3 border border-line bg-bg cursor-not-allowed"
            >
              {chip.label}
            </button>
          ))}
        </div>

        <SearchResults query={debounced} onSelect={handleSelect} />

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
