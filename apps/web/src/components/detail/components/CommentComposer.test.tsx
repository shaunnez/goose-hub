/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { CommentComposer } from './CommentComposer';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  addComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/components/ui/MarkdownEditor', () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    tab?: string;
    onTabChange?: (t: string) => void;
    rows?: number;
  }) => (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid="mock-editor"
    />
  ),
}));

function renderComposer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CommentComposer projectSlug="test-proj" externalId="42" issueId="42" />
    </QueryClientProvider>,
  );
}

describe('CommentComposer', () => {
  it('renders the composer form', () => {
    renderComposer();
    expect(screen.getByTestId('comment-composer')).toBeTruthy();
  });

  it('submit button is disabled when textarea is empty', () => {
    renderComposer();
    const btn = screen.getByTestId('comment-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('submit button enables after typing', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByTestId('mock-editor'), 'hello');
    const btn = screen.getByTestId('comment-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('clears the textarea after successful submit', async () => {
    const user = userEvent.setup();
    renderComposer();
    const ta = screen.getByTestId('mock-editor') as HTMLTextAreaElement;
    await user.type(ta, 'my comment');
    await user.click(screen.getByTestId('comment-submit'));
    await waitFor(() => expect(ta.value).toBe(''));
  });
});
