import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentsSection } from './CommentsSection';

afterEach(cleanup);

// Mock all API and utility dependencies
vi.mock('@/lib/api', () => ({
  fetchComments: vi.fn().mockResolvedValue([]),
  addComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/markdown', () => ({
  renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('@/lib/utils', () => ({
  timeAgo: () => '5m ago',
}));

// Mock CommentComposer to avoid rendering its full dependency tree
vi.mock('./CommentComposer', () => ({
  CommentComposer: () => <div data-testid="comment-composer-mock">composer</div>,
}));

// API returns comments oldest-first: bob (2h ago) then alice (1h ago)
const MOCK_COMMENTS = [
  {
    id: 1,
    body: '**Hello**',
    authorLogin: 'bob',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 2,
    body: 'World',
    authorLogin: 'alice',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

function renderSection(comments = MOCK_COMMENTS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pre-populate cache so render is synchronous
  qc.setQueryData(['comments', 'test-proj', '42'], comments);
  render(
    <QueryClientProvider client={qc}>
      <CommentsSection projectSlug="test-proj" id="42" externalId="42" />
    </QueryClientProvider>,
  );
}

describe('CommentsSection', () => {
  it('renders the section container', () => {
    renderSection();
    expect(screen.getByTestId('comments-section')).toBeTruthy();
  });

  it('shows comment count in heading', () => {
    renderSection();
    expect(screen.getByText('(2)')).toBeTruthy();
  });

  it('renders each comment author', () => {
    renderSection();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('renders the composer', () => {
    renderSection();
    expect(screen.getByTestId('comment-composer-mock')).toBeTruthy();
  });

  it('shows no count when comments array is empty', () => {
    renderSection([]);
    expect(screen.queryByText(/\(\d+\)/)).toBeNull();
  });

  it('defaults to newest-first order', () => {
    renderSection();
    const authors = screen.getAllByText(/alice|bob/).map((el) => el.textContent);
    // bob is older, alice is newer — newest first means alice before bob
    expect(authors[0]).toBe('alice');
    expect(authors[1]).toBe('bob');
  });

  it('shows the sort toggle when there are multiple comments', () => {
    renderSection();
    expect(screen.getByTestId('sort-order-toggle')).toBeTruthy();
  });

  it('hides the sort toggle when there is only one comment', () => {
    renderSection([MOCK_COMMENTS[0]]);
    expect(screen.queryByTestId('sort-order-toggle')).toBeNull();
  });

  it('reverses order when the toggle is clicked', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('sort-order-toggle'));
    const authors = screen.getAllByText(/alice|bob/).map((el) => el.textContent);
    // oldest first: bob before alice
    expect(authors[0]).toBe('bob');
    expect(authors[1]).toBe('alice');
  });

  it('toggles label between "Oldest first" and "Newest first"', () => {
    renderSection();
    const toggle = screen.getByTestId('sort-order-toggle');
    expect(toggle.textContent).toBe('Oldest first');
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('Newest first');
  });
});
