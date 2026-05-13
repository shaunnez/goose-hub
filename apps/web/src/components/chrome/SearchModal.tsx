import { fetchIssues, fetchProjects } from '@/lib/api';
import type { ProjectSummary, WorkItemDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

interface SearchHit {
  slug: string;
  projectName: string;
  item: WorkItemDto;
}

async function fetchAllIssues(): Promise<SearchHit[]> {
  const projects: ProjectSummary[] = await fetchProjects();
  const results = await Promise.all(
    projects.map(async (p) => {
      const items = await fetchIssues(p.slug).catch(() => [] as WorkItemDto[]);
      return items.map((item) => ({ slug: p.slug, projectName: p.name, item }));
    }),
  );
  return results.flat();
}

function matches(query: string, hit: SearchHit): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase();
  return (
    hit.item.title.toLowerCase().includes(q) ||
    `#${hit.item.externalId}`.toLowerCase().includes(q) ||
    hit.item.externalId.toLowerCase().includes(q)
  );
}

const PLACEHOLDER = 'Start typing to search…';

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data: hits = [], isLoading } = useQuery<SearchHit[]>({
    queryKey: ['all-issues'],
    queryFn: fetchAllIssues,
    staleTime: 60_000,
    enabled: open,
  });

  const filtered = useMemo(() => {
    if (query.length === 0) {
      // Mixed sources (GitHub numeric ids + Jira keys like PAY-42) — sort
      // by createdAt desc (most recent first), falling back to a string
      // compare so the order stays deterministic when timestamps tie.
      return [...hits]
        .sort((a, b) => {
          const at = new Date(a.item.createdAt).getTime();
          const bt = new Date(b.item.createdAt).getTime();
          if (bt !== at) return bt - at;
          return a.item.externalId.localeCompare(b.item.externalId);
        })
        .slice(0, 20);
    }
    return hits.filter((h) => matches(query, h)).slice(0, 50);
  }, [hits, query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query/hits change is the intent
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, hits]);

  useEffect(() => {
    if (open) {
      // Defer focus so the input has mounted before we grab it.
      const id = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
    setQuery('');
    setSelectedIndex(0);
    return undefined;
  }, [open]);

  if (!open) return null;

  const select = (hit: SearchHit) => {
    navigate(`/projects/${hit.slug}/items/${hit.item.externalId}`);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      select(filtered[selectedIndex]);
    }
  };

  return (
    <div
      data-testid="search-modal"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> on flex layout doesn't slot the same; using role
      role="dialog"
      aria-modal="true"
      aria-label="Search issues"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        paddingTop: 80,
      }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keydown is handled on the parent backdrop; this inner stopPropagation prevents bubbling */}
      <div
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          width: '100%',
          maxWidth: 640,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--fg)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          data-testid="search-modal-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDER}
          style={{
            background: 'var(--bg)',
            color: 'var(--fg)',
            border: 'none',
            borderBottom: '1px solid var(--line)',
            padding: '14px 16px',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
          }}
          data-testid="search-modal-results"
        >
          {isLoading && <div className="px-4 py-3 text-[12.5px] text-fg-3">Loading…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="px-4 py-6 text-[12.5px] text-fg-3" data-testid="search-modal-empty">
              {query.length === 0 ? PLACEHOLDER : 'No issues found'}
            </div>
          )}
          {filtered.map((hit, idx) => {
            const selected = idx === selectedIndex;
            return (
              <button
                key={`${hit.slug}/${hit.item.externalId}`}
                type="button"
                data-testid="search-modal-result"
                data-slug={hit.slug}
                data-external-id={hit.item.externalId}
                onClick={() => select(hit)}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  display: 'flex',
                  width: '100%',
                  textAlign: 'left',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 16px',
                  background: selected ? 'var(--bg-elev-2)' : 'transparent',
                  border: 'none',
                  color: 'var(--fg)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <span className="font-mono" style={{ color: 'var(--fg-3)', minWidth: 56 }}>
                  #{hit.item.externalId}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {hit.item.title}
                </span>
                <span className="font-mono" style={{ color: 'var(--fg-3)', fontSize: 11.5 }}>
                  {hit.slug}
                </span>
                <span
                  style={{
                    color: 'var(--fg-2)',
                    fontSize: 11.5,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                  }}
                >
                  {hit.item.state.replace('factory:', '')}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
