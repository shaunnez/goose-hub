/** @vitest-environment jsdom */
import { addComment, fetchComments, proceedToPrd, transitionState } from '@/lib/api';
import type { IssueCommentDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRILL_QUESTION_MARKER, GRILL_REPLY_MARKER } from '../lib/grill-comments';
import { GrillSection } from './GrillSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchComments: vi.fn(),
  addComment: vi.fn(),
  transitionState: vi.fn(),
  proceedToPrd: vi.fn(),
}));

// Reset call history between tests so call-count assertions in one test
// aren't polluted by other tests in the same file.
beforeEach(() => {
  vi.mocked(fetchComments).mockClear();
  vi.mocked(addComment).mockClear();
  vi.mocked(transitionState).mockClear();
  vi.mocked(proceedToPrd).mockClear();
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
      comment(1, `${GRILL_QUESTION_MARKER}\n**Round 1** — What does better mean?`),
      comment(2, `${GRILL_REPLY_MARKER}\nBetter means fewer drop-offs.`),
    ]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
      expect(screen.getAllByTestId('grill-msg-user')).toHaveLength(1);
    });
  });

  it('renders marked grill question', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_QUESTION_MARKER}\nWhat does better mean?`, 'factory-agent'),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => {
      expect(screen.getByTestId('grill-msg-agent').textContent).toContain('griller');
    });
    expect(screen.getByTestId('grill-msg-agent').textContent).toContain('What does better mean?');
    expect(screen.getByTestId('grill-msg-agent').textContent).not.toContain(
      'factory:grill-question',
    );
  });

  it('renders marked grill reply as the comment author', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_REPLY_MARKER}\nBetter means fewer drop-offs.`, 'shaun'),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => {
      expect(screen.getByTestId('grill-msg-user').textContent).toContain('shaun');
    });
    expect(screen.getByTestId('grill-msg-user').textContent).toContain(
      'Better means fewer drop-offs.',
    );
    expect(screen.getByTestId('grill-msg-user').textContent).not.toContain('factory:grill-reply');
  });

  it('preserves legacy unmarked human replies after a grill question', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_QUESTION_MARKER}\nQ?`),
      comment(2, 'Legacy answer before reply markers existed.'),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
    });
    expect(screen.getByTestId('grill-msg-user').textContent).toContain(
      'Legacy answer before reply markers existed.',
    );
  });

  it('hides unmarked human comments before the grill thread starts', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, 'Plain GitHub comment.'),
      comment(2, `${GRILL_QUESTION_MARKER}\nQ?`),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
    });
    expect(screen.queryByText('Plain GitHub comment.')).toBeNull();
  });

  it('hides [Investigate] Escalated comments from the grill thread', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_QUESTION_MARKER}\nQ?`),
      comment(2, '[Investigate] Escalated\nNeeds additional research.'),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
    });
    expect(screen.queryByTestId('grill-msg-user')).toBeNull();
    expect(screen.queryByText('[Investigate] Escalated')).toBeNull();
  });

  it('Send button posts a comment and (when gate-pending) transitions back to grilling', async () => {
    vi.mocked(fetchComments).mockResolvedValue([comment(1, `${GRILL_QUESTION_MARKER}\nQ?`)]);
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
      expect(addComment).toHaveBeenCalledWith(
        'proj',
        '42',
        `${GRILL_REPLY_MARKER}\nBetter means fewer drop-offs.`,
      );
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

  it('does NOT show reply form when state is factory:grilling (agent is processing)', async () => {
    vi.mocked(fetchComments).mockResolvedValue([]);

    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => expect(screen.getByTestId('grill-processing-footer')).toBeTruthy());
    expect(screen.queryByTestId('grill-reply-form')).toBeNull();
    expect(transitionState).not.toHaveBeenCalled();
  });

  it('shows the reply form when raw state is stale but the latest grill comment is unanswered', async () => {
    vi.mocked(fetchComments).mockResolvedValue([comment(1, `${GRILL_QUESTION_MARKER}\nQ?`)]);

    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);

    await waitFor(() => expect(screen.getByTestId('grill-reply-form')).toBeTruthy());
    expect(screen.queryByTestId('grill-processing-footer')).toBeNull();
  });

  it('uses effective gate-pending state when replying after a stale factory:grilling render', async () => {
    vi.mocked(fetchComments).mockResolvedValue([comment(1, `${GRILL_QUESTION_MARKER}\nQ?`)]);
    vi.mocked(addComment).mockResolvedValueOnce(undefined);
    vi.mocked(transitionState).mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
    });

    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => expect(screen.getByTestId('grill-reply-input')).toBeTruthy());

    fireEvent.change(screen.getByTestId('grill-reply-input'), { target: { value: 'Answer.' } });
    await waitFor(() => {
      expect((screen.getByTestId('grill-send-btn') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('grill-send-btn'));

    await waitFor(() => {
      expect(transitionState).toHaveBeenCalledWith(
        'proj',
        '42',
        'factory:gate-pending',
        'factory:grilling',
      );
    });
  });

  it('shows the optimistic reply in the thread before round-trip resolves', async () => {
    vi.mocked(fetchComments).mockResolvedValue([comment(1, `${GRILL_QUESTION_MARKER}\nQ?`)]);
    const pending = new Promise<void>((resolve) => {
      // Stash the resolver on the ref so the test can drain the mutation
      // after assertions complete.
      pendingResolver.current = resolve;
    });
    vi.mocked(addComment).mockImplementationOnce(() => pending);

    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => expect(screen.getByTestId('grill-reply-input')).toBeTruthy());

    fireEvent.change(screen.getByTestId('grill-reply-input'), { target: { value: 'optimistic!' } });
    fireEvent.click(screen.getByTestId('grill-send-btn'));

    // The optimistic reply should appear immediately, before addComment resolves.
    await waitFor(() => {
      const userMsgs = screen.getAllByTestId('grill-msg-user');
      expect(userMsgs.some((el) => el.getAttribute('data-optimistic') === 'true')).toBe(true);
      expect(userMsgs.some((el) => el.textContent?.includes('factory:grill-reply'))).toBe(false);
    });

    // Drain the pending mutation so React Query doesn't keep the promise open.
    pendingResolver.current?.();
  });

  it('filters out <!-- factory:system --> comments from the grill thread', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_QUESTION_MARKER}\nQ?`),
      comment(2, '<!-- factory:system -->\nUser rejected the PRD; returning to grill.'),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:grilling" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
    });
    expect(screen.queryByTestId('grill-msg-user')).toBeNull();
  });

  it('filters out ## Child issues comments from the grill thread', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_QUESTION_MARKER}\nQ?`),
      comment(2, '## Child issues\n- #101 Slice 1\n- #102 Slice 2'),
    ]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:decomposing" />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(1);
    });
    expect(screen.queryByTestId('grill-msg-user')).toBeNull();
  });

  it('renders the "Grilling complete" footer when state has progressed past grilling', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([comment(1, `${GRILL_QUESTION_MARKER}\nQ?`)]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('grill-complete-footer')).toBeTruthy();
    });
    expect(screen.queryByTestId('grill-reply-form')).toBeNull();
  });

  it('shows the complete footer before comment loading finishes for post-grill states', () => {
    vi.mocked(fetchComments).mockImplementationOnce(() => new Promise(() => {}));
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:prd-review" />);
    expect(screen.getByTestId('grill-complete-footer')).toBeTruthy();
    expect(screen.queryByTestId('grill-loading')).toBeNull();
  });

  it('shows recommended answer pill on the last agent question when state is gate-pending', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(
        1,
        `${GRILL_QUESTION_MARKER}\nWhat does "better" mean?\n<!-- factory:recommended-answer -->\nFewer user drop-offs on the checkout screen.`,
      ),
    ]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('grill-recommended-answer')).toBeTruthy();
    });
    expect(screen.getByTestId('grill-recommended-answer').textContent).toContain(
      'Fewer user drop-offs',
    );
    // Recommended answer text must not bleed into the question text
    const agentMsg = screen.getByTestId('grill-msg-agent');
    expect(agentMsg.textContent).not.toContain('factory:recommended-answer');
  });

  it('fills the textarea when "Use this" is clicked', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(
        1,
        `${GRILL_QUESTION_MARKER}\nQ?\n<!-- factory:recommended-answer -->\nSuggested text here.`,
      ),
    ]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => expect(screen.getByTestId('grill-use-answer-btn')).toBeTruthy());
    fireEvent.click(screen.getByTestId('grill-use-answer-btn'));
    expect((screen.getByTestId('grill-reply-input') as HTMLTextAreaElement).value).toBe(
      'Suggested text here.',
    );
  });

  it('does not show recommended answer pill when state is not gate-pending', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_QUESTION_MARKER}\nQ?\n<!-- factory:recommended-answer -->\nAnswer.`),
    ]);
    render_(<GrillSection projectSlug="proj" externalId="42" id="42" state="factory:prd-review" />);
    await waitFor(() => expect(screen.getByTestId('grill-msg-agent')).toBeTruthy());
    expect(screen.queryByTestId('grill-recommended-answer')).toBeNull();
  });

  it('does not show recommended answer from an earlier grill question', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(
        1,
        `${GRILL_QUESTION_MARKER}\nFirst question?\n<!-- factory:recommended-answer -->\nOld answer.`,
      ),
      comment(2, `${GRILL_REPLY_MARKER}\nFirst reply.`),
      comment(3, `${GRILL_QUESTION_MARKER}\nLatest question?`),
    ]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => expect(screen.getAllByTestId('grill-msg-agent')).toHaveLength(2));
    expect(screen.queryByTestId('grill-recommended-answer')).toBeNull();
  });

  it('keeps recommended-answer parsing on questions only', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([
      comment(1, `${GRILL_QUESTION_MARKER}\nQ?`),
      comment(2, `${GRILL_REPLY_MARKER}\nA.\n<!-- factory:recommended-answer -->\nIgnore me.`),
    ]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => expect(screen.getByTestId('grill-msg-agent')).toBeTruthy());
    expect(screen.queryByTestId('grill-recommended-answer')).toBeNull();
  });

  it('shows "Proceed to PRD" button in gate-pending state', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([comment(1, `${GRILL_QUESTION_MARKER}\nQ?`)]);
    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => expect(screen.getByTestId('grill-proceed-btn')).toBeTruthy());
  });

  it('calls proceedToPrd when "Proceed to PRD" is clicked', async () => {
    vi.mocked(fetchComments).mockResolvedValueOnce([comment(1, `${GRILL_QUESTION_MARKER}\nQ?`)]);
    vi.mocked(proceedToPrd).mockResolvedValueOnce({ ok: true });

    render_(
      <GrillSection projectSlug="proj" externalId="42" id="42" state="factory:gate-pending" />,
    );
    await waitFor(() => expect(screen.getByTestId('grill-proceed-btn')).toBeTruthy());
    fireEvent.click(screen.getByTestId('grill-proceed-btn'));
    await waitFor(() => {
      expect(proceedToPrd).toHaveBeenCalledWith('proj', '42');
    });
  });
});
