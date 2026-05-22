import { addComment, fetchComments, proceedToPrd, transitionState } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { IssueCommentDto } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  GRILL_REPLY_MARKER,
  isGrillQuestion,
  parseRecommendedAnswer,
  selectGrillThreadComments,
  stripGrillMarker,
  stripRecommendedAnswer,
} from '../lib/grill-comments';
import { SectionEmptyState } from './SectionEmptyState';

interface GrillSectionProps {
  projectSlug: string;
  externalId: string;
  id: string;
  state: string | undefined;
}

interface OptimisticReply extends IssueCommentDto {
  __optimistic: true;
}

export function GrillSection({ projectSlug, externalId, id, state }: GrillSectionProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [optimisticReplies, setOptimisticReplies] = useState<OptimisticReply[]>([]);

  const { data: comments = [], isLoading } = useQuery<IssueCommentDto[]>({
    queryKey: ['comments', projectSlug, id],
    queryFn: () => fetchComments(projectSlug, id),
  });

  // Refetch comments when the issue state changes — the grill workflow posts
  // a question comment as part of the transition into factory:gate-pending,
  // and without this hook the cache (loaded at factory:grilling) misses it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state is a prop; biome doesn't recognise it
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, id] });
  }, [state, projectSlug, id, queryClient]);

  const send = useMutation({
    mutationFn: async (input: { body: string; shouldTransitionToGrilling: boolean }) => {
      const { body, shouldTransitionToGrilling } = input;
      await addComment(projectSlug, externalId, body);
      // After posting a reply during gate-pending, advance the issue back to
      // grilling so the orchestrator can pick it up on the next tick. This is
      // a no-op when the issue is already in a non-gate state.
      if (shouldTransitionToGrilling) {
        await transitionState(projectSlug, id, 'factory:gate-pending', 'factory:grilling');
      }
    },
    onSuccess: () => {
      setText('');
      setOptimisticReplies([]);
      void queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, id] });
      void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
      void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    },
    onError: (err: unknown) => {
      // Revert the optimistic reply on failure.
      setOptimisticReplies([]);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    },
  });

  const proceed = useMutation({
    mutationFn: () => proceedToPrd(projectSlug, externalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
      void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    },
  });

  const grillComments = selectGrillThreadComments(comments);
  const merged: Array<IssueCommentDto | OptimisticReply> = [...grillComments, ...optimisticReplies];
  const latestThreadComment = merged.at(-1);
  const hasLatestUnansweredQuestion =
    latestThreadComment != null && isGrillQuestion(latestThreadComment.body);
  const effectiveState =
    state === 'factory:grilling' && hasLatestUnansweredQuestion ? 'factory:gate-pending' : state;

  // The last agent question in the thread (used for recommended-answer pill).
  const lastAgentQuestionId = [...merged].reverse().find((c) => isGrillQuestion(c.body))?.id;

  const grillingComplete =
    effectiveState === 'factory:prd-drafting' ||
    effectiveState === 'factory:prd-review' ||
    effectiveState === 'factory:decomposing' ||
    effectiveState === 'factory:issues-created' ||
    effectiveState === 'factory:done';

  // Griller is processing a reply — hide the form but don't show "complete" yet.
  const grillingInProgress = effectiveState === 'factory:grilling';
  const awaitingReply = effectiveState === 'factory:gate-pending';

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || send.isPending) return;
    const replyBody = `${GRILL_REPLY_MARKER}\n${trimmed}`;
    setErrorMsg(null);
    const shouldTransitionToGrilling = effectiveState === 'factory:gate-pending';
    // Optimistic insert.
    const reply: OptimisticReply = {
      id: -Date.now(),
      body: replyBody,
      authorLogin: 'you',
      createdAt: new Date().toISOString(),
      __optimistic: true,
    };
    setOptimisticReplies((prev) => [...prev, reply]);
    send.mutate({ body: replyBody, shouldTransitionToGrilling });
  };

  if (isLoading) {
    return (
      <div className="px-8 py-6 text-[12.5px] text-fg-2" data-testid="grill-loading">
        Loading…
      </div>
    );
  }

  return (
    <div className="px-8 py-6 flex flex-col gap-4" data-testid="grill-section">
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">04 · Grill</div>
        <h2 className="text-[18px] font-semibold text-fg leading-snug">Discover-lane chat</h2>
        <p className="text-[12.5px] text-fg-2 mt-1">
          The griller asks one question at a time until the scope is precise enough to draft a PRD.
        </p>
      </div>

      {grillingComplete && (
        <div
          data-testid="grill-complete-footer"
          className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 flex items-center gap-2"
        >
          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          <span className="text-[13px] text-green-300 font-medium">Grilling complete</span>
          <span className="text-[12px] text-fg-3 ml-1">
            — PRD drafted, open the PRD tab to review
          </span>
        </div>
      )}

      {merged.length === 0 ? (
        <SectionEmptyState
          data-testid="grill-empty-state"
          icon={MessageCircleQuestion}
          title="No grill conversation yet."
          subtitle="The griller will post its first question shortly."
        />
      ) : (
        <ol className="flex flex-col gap-3" data-testid="grill-thread">
          {merged.map((c) => {
            const agent = isGrillQuestion(c.body);
            const rawStripped = stripGrillMarker(c.body);
            const display = agent ? stripRecommendedAnswer(rawStripped) : rawStripped;
            const isOptimistic = '__optimistic' in c && c.__optimistic === true;
            const recommendedAnswer =
              agent && c.id === lastAgentQuestionId && awaitingReply
                ? parseRecommendedAnswer(c.body)
                : null;
            return (
              <li
                key={c.id}
                data-testid={agent ? 'grill-msg-agent' : 'grill-msg-user'}
                data-optimistic={isOptimistic ? 'true' : undefined}
                className={`rounded-md border px-3 py-2 ${
                  agent ? 'border-line bg-bg-elev/60' : 'border-accent/40 bg-accent-soft/40 ml-8'
                } ${isOptimistic ? 'opacity-70' : ''}`}
              >
                <div className="flex items-center gap-2 text-[11px] text-fg-2 mb-1">
                  <span className="font-medium text-fg-2">{agent ? 'griller' : c.authorLogin}</span>
                  <span>·</span>
                  <span>{timeAgo(c.createdAt)}</span>
                  {isOptimistic && <span className="text-fg-3">(sending…)</span>}
                </div>
                <div
                  className="prose-fix text-[12.5px]"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdownToHtml escapes raw input
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(display) }}
                />
                {recommendedAnswer != null && (
                  <div
                    data-testid="grill-recommended-answer"
                    className="mt-2 rounded border border-accent/30 bg-accent-soft/20 px-2 py-1.5 text-[11.5px]"
                  >
                    <div className="text-[10.5px] font-medium text-fg-2 uppercase tracking-wider mb-1">
                      Suggested answer
                    </div>
                    <p className="text-fg-2 leading-snug">{recommendedAnswer}</p>
                    <button
                      type="button"
                      data-testid="grill-use-answer-btn"
                      onClick={() => setText(recommendedAnswer)}
                      className="mt-1.5 text-[11px] text-accent hover:underline"
                    >
                      Use this
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {grillingInProgress ? (
        <div
          data-testid="grill-processing-footer"
          className="text-[12px] text-fg-2 border-t border-line pt-3"
        >
          Griller is processing your reply…
        </div>
      ) : awaitingReply ? (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 border-t border-line pt-3"
          data-testid="grill-reply-form"
        >
          <textarea
            data-testid="grill-reply-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Reply to the griller…"
            className="rounded-md border border-line bg-bg p-2 text-[12.5px] resize-y"
          />
          {errorMsg != null && (
            <div className="text-[12px] text-red-400" data-testid="grill-error">
              {errorMsg}
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              data-testid="grill-proceed-btn"
              disabled={proceed.isPending || send.isPending}
              onClick={() => proceed.mutate()}
              className="h-8 px-3 rounded-md border border-line text-[12px] text-fg-2 hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {proceed.isPending ? 'Proceeding…' : 'Proceed to PRD'}
            </button>
            <button
              type="submit"
              data-testid="grill-send-btn"
              disabled={send.isPending || text.trim().length === 0}
              className="h-8 px-4 rounded-md bg-accent text-accent-fg text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
