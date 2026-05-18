import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

// PR-1 scope: skeleton only. Filter chips render but do not yet filter;
// results are wired in a follow-up PR. Live search lands with #834 PR-3.
const FILTER_CHIPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'scope', label: 'This project' },
  { key: 'milestone', label: 'Active milestone' },
  { key: 'type', label: 'Any type' },
  { key: 'includeClosed', label: 'Open only' },
];

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

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

        <div data-testid="search-body" className="px-4 py-10 min-h-[200px]">
          <p className="text-[12.5px] text-fg-3 text-center">
            Start typing to search work items across all projects.
          </p>
        </div>

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
