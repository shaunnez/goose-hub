import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
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

const MOCK_COMMENTS = [
  {
    id: 1,
    body: '**Hello**',
    authorLogin: 'alice',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 2,
    body: 'World',
    authorLogin: 'bob',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
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
});
