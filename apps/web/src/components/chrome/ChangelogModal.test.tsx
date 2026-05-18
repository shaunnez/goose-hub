/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangelogModal, formatRelative } from './ChangelogModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function entry(
  overrides: Partial<{
    number: number;
    title: string;
    mergedAt: string;
    url: string;
    repo: string;
    author: string;
  }> = {},
) {
  return {
    number: 1,
    title: 'Some PR',
    mergedAt: '2026-05-12T10:00:00Z',
    url: 'https://github.com/o/r/pull/1',
    repo: 'o/r',
    author: 'octocat',
    ...overrides,
  };
}

describe('ChangelogModal', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
  });

  it('does not render when open=false', () => {
    render(<ChangelogModal open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('changelog-modal')).toBeNull();
  });

  it('renders Last 7 days heading when open', () => {
    render(<ChangelogModal open={true} onClose={() => {}} />);
    expect(screen.getByText('Last 7 days')).toBeTruthy();
  });

  it('shows loading state while fetch is pending', () => {
    render(<ChangelogModal open={true} onClose={() => {}} />);
    expect(screen.getByTestId('changelog-loading')).toBeTruthy();
  });

  it('renders entries grouped by repo on successful fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          entry({ number: 1, repo: 'o/a', title: 'First', mergedAt: '2026-05-10T10:00:00Z' }),
          entry({ number: 2, repo: 'o/a', title: 'Second', mergedAt: '2026-05-12T10:00:00Z' }),
          entry({ number: 3, repo: 'o/b', title: 'Third', mergedAt: '2026-05-11T10:00:00Z' }),
        ]),
        { status: 200 },
      ),
    );
    render(<ChangelogModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('changelog-list')).toBeTruthy();
    });
    const items = screen.getAllByTestId('changelog-entry');
    expect(items).toHaveLength(3);
    expect(screen.getByText('o/a')).toBeTruthy();
    expect(screen.getByText('o/b')).toBeTruthy();
  });

  it('within each repo group, entries are sorted newest first', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          entry({ number: 1, repo: 'o/a', title: 'Older', mergedAt: '2026-05-08T10:00:00Z' }),
          entry({ number: 2, repo: 'o/a', title: 'Newer', mergedAt: '2026-05-12T10:00:00Z' }),
        ]),
        { status: 200 },
      ),
    );
    render(<ChangelogModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('changelog-list')).toBeTruthy();
    });
    const items = screen.getAllByTestId('changelog-entry');
    expect(items[0].textContent).toContain('Newer');
    expect(items[1].textContent).toContain('Older');
  });

  it('renders empty state when fetch returns []', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    render(<ChangelogModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('changelog-empty')).toBeTruthy();
    });
    expect(screen.getByText('No merged PRs in the last 7 days.')).toBeTruthy();
  });

  it('renders error state on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    render(<ChangelogModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('changelog-error')).toBeTruthy();
    });
    expect(screen.getByText('Could not load changelog.')).toBeTruthy();
  });

  it('renders error state when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    render(<ChangelogModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('changelog-error')).toBeTruthy();
    });
  });

  it('PR links open in new tab with safe rel attributes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([entry()]), { status: 200 }),
    );
    render(<ChangelogModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('changelog-list')).toBeTruthy();
    });
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('fetches /api/changelog?days=7 when modal opens', () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<ChangelogModal open={true} onClose={() => {}} />);
    expect(spy).toHaveBeenCalledWith('/api/changelog?days=7');
  });
});

describe('formatRelative', () => {
  it('returns "yesterday"-style copy for ~1 day ago', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    expect(formatRelative('2026-05-12T12:00:00Z', now)).toMatch(/day/);
  });

  it('returns hour-scale copy for sub-day deltas', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    expect(formatRelative('2026-05-13T09:00:00Z', now)).toMatch(/hour/);
  });

  it('returns input verbatim for unparseable dates', () => {
    expect(formatRelative('not-a-date')).toBe('not-a-date');
  });
});
