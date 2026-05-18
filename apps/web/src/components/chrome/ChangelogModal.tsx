import { useEffect, useState } from 'react';

interface ChangelogEntry {
  number: number;
  title: string;
  mergedAt: string;
  url: string;
  repo: string;
  author: string;
}

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'loaded'; entries: ChangelogEntry[] }
  | { status: 'error' };

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetch('/api/changelog?days=7')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const entries = (await res.json()) as ChangelogEntry[];
        if (!cancelled) setState({ status: 'loaded', entries });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="changelog-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: '24px',
          width: '100%',
          maxWidth: 560,
          maxHeight: '80vh',
          overflowY: 'auto',
          color: 'var(--fg)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2
          style={{
            margin: '0 0 16px',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--fg)',
          }}
        >
          Last 7 days
        </h2>

        {state.status === 'loading' && (
          <p data-testid="changelog-loading" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            Loading…
          </p>
        )}

        {state.status === 'error' && (
          <p data-testid="changelog-error" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            Could not load changelog.
          </p>
        )}

        {state.status === 'loaded' && state.entries.length === 0 && (
          <p data-testid="changelog-empty" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            No merged PRs in the last 7 days.
          </p>
        )}

        {state.status === 'loaded' && state.entries.length > 0 && (
          <ChangelogList entries={state.entries} />
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            data-testid="changelog-close"
            onClick={onClose}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--bg)',
              color: 'var(--fg-2)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangelogList({ entries }: { entries: ChangelogEntry[] }) {
  const groups = groupByRepo(entries);
  return (
    <div data-testid="changelog-list" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map(([repo, items]) => (
        <section key={repo}>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>
            {repo}
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((e) => (
              <li
                key={`${e.repo}#${e.number}`}
                data-testid="changelog-entry"
                style={{ padding: '4px 0', fontSize: 13 }}
              >
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--fg)', textDecoration: 'none' }}
                >
                  #{e.number} {e.title}
                </a>
                <span style={{ marginLeft: 8, color: 'var(--fg-2)', fontSize: 12 }}>
                  {e.author} · {formatRelative(e.mergedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupByRepo(entries: ChangelogEntry[]): Array<[string, ChangelogEntry[]]> {
  const map = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const arr = map.get(entry.repo) ?? [];
    arr.push(entry);
    map.set(entry.repo, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  }
  return Array.from(map.entries());
}

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

export function formatRelative(iso: string, now: Date = new Date()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diffSeconds = Math.round((ms - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (abs >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return rtf.format(diffSeconds, 'second');
}
