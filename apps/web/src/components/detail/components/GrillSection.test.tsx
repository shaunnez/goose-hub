/** @vitest-environment jsdom */
import { addComment, fetchComments, transitionState } from '@/lib/api';
import type { IssueCommentDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrillSection } from './GrillSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchComments: vi.fn(),
  addComment: vi.fn(),
  transitionState: vi.fn(),
}));

// Reset call history between tests so call-count assertions in one test
// aren't polluted by other tests in the same file.
import { beforeEach } from 'vitest';
beforeEach(() => {
  vi.mocked(fetchComments).mockClear();
  vi.mocked(addComment).mockClear();
  vi.mocked(transitionState).mockClear();
});

function comment(id: number, body: string, author = 'shaun'): IssueCommentDto {
  return { id, body, authorLogin: author, createdAt: '2026-05-07T10:00:00Z' };
}

// React-style mutable holder so the optimistic-reply test can stash a
// promise resolver from inside the addComment mock without TS narrowing the
// outer `let` binding to `null`.
const pendingResolver: { current: (() => void) | null } = { current: null };

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

describe('GrillSection', () => {
  it('renders empty state when there are no comments', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => {
      expect(screen.getByTestId('grill-empty-state')).toBeTruthy();
    });
  });

  it('distinguishes agent question (with marker) from user reply', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, '<!-- factory:grill-question -->\n**Round 1** — What does better mean?'),
      comment(2, 'Better means fewer drop-offs.'),
    ]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
      expect(screen.getAllByTestId('grill-msg-user')).toHaveLength(1);
    });
  });

  it('filters out PRD marker comments from the chat thread', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, '<!-- factory:grill-question -->\nQ?'),
      comment(2, '<!-- factory:prd -->\n# PRD'),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
    });
    expect(screen.queryByTestId('grill-msg-user')).toBeNull();
  });

  it('Send button posts a comment and (when gate-pending) transitions back to grilling', async () => {
    vi.mocked(fetchComments).mockResolvedValue([comment(1, '<!-- factory:grill-question -->\nQ?')]);
    vi.mocked(addComment).mockResolvedValueOnce(undefined);
    vi.mocked(transitionState).mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
    });

    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('grill-reply-input')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('grill-reply-input'), {
      target: { value: 'Better means fewer drop-offs.' },
    });
    fireEvent.click(screen.getByTestId('grill-send-btn'));

    await waitFor(() => {
      expect(addComment).toHaveBeenCalledWith('proj', '42', 'Better means fewer drop-offs.');
    });
    await waitFor(() => {
      expect(transitionState).toHaveBeenCalledWith(
        'proj',
        '42',
        'factory:gate-pending',
        'factory:grilling',
      );
    });
  });

  it('does NOT call transitionState when the issue is already in factory:grilling', async () => {
    vi.mocked(fetchComments).mockResolvedValue([]);
    vi.mocked(addComment).mockResolvedValueOnce(undefined);

    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => expect(screen.getByTestId('grill-reply-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('grill-reply-input'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('grill-send-btn'));

    await waitFor(() => expect(addComment).toHaveBeenCalled());
    expect(transitionState).not.toHaveBeenCalled();
  });

  it('shows the optimistic reply in the thread before round-trip resolves', async () => {
    vi.mocked(fetchComments).mockResolvedValue([]);
    const pending = new Promise<void>((resolve) => {
      // Stash the resolver on the ref so the test can drain the mutation
      // after assertions complete.
      pendingResolver.current = resolve;
    });
    vi.mocked(addComment).mockImplementationOnce(() => pending);

    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => expect(screen.getByTestId('grill-reply-input')).toBeTruthy());

    fireEvent.change(screen.getByTestId('grill-reply-input'), { target: { value: 'optimistic!' } });
    fireEvent.click(screen.getByTestId('grill-send-btn'));

    // The optimistic reply should appear immediately, before addComment resolves.
    await waitFor(() => {
      const userMsgs = screen.getAllByTestId('grill-msg-user');
      expect(userMsgs.some((el) => el.getAttribute('data-optimistic') === 'true')).toBe(true);
    });

    // Drain the pending mutation so React Query doesn't keep the promise open.
    pendingResolver.current?.();
  });

  it('renders the "Grilling complete" footer when state has progressed past grilling', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, '<!-- factory:grill-question -->\nQ?'),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('grill-complete-footer')).toBeTruthy();
    });
    expect(screen.queryByTestId('grill-reply-form')).toBeNull();
  });
});
