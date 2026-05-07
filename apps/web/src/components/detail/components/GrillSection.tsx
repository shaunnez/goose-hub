import { addComment, fetchComments, transitionState } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { IssueCommentDto } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import { SectionEmptyState } from './SectionEmptyState';

interface GrillSectionProps {
  projectSlug: string;
  externalId: string;
  id: string;
  state: string | undefined;
}

const GRILL_QUESTION_MARKER = '<!-- factory:grill-question -->';
const PRD_MARKER = '<!-- factory:prd -->';

function isAgentQuestion(body: string): boolean {
  return body.startsWith(GRILL_QUESTION_MARKER);
}

function stripMarker(body: string): string {
  if (body.startsWith(GRILL_QUESTION_MARKER)) {
    return body.slice(GRILL_QUESTION_MARKER.length).trimStart();
  }
  return body;
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

  const send = useMutation({
    mutationFn: async (body: string) => {
      await addComment(projectSlug, externalId, body);
      // After posting a reply during gate-pending, advance the issue back to
      // grilling so the orchestrator can pick it up on the next tick. This is
      // a no-op when the issue is already in a non-gate state.
      if (state === 'factory:gate-pending') {
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

  // Filter out the PRD marker comment — it's rendered on the PRD tab, not here.
  const grillComments = comments.filter((c) => !c.body.startsWith(PRD_MARKER));
  const merged: Array<IssueCommentDto | OptimisticReply> = [...grillComments, ...optimisticReplies];

  const grillingComplete =
    state === 'factory:prd-drafting' ||
    state === 'factory:prd-review' ||
    state === 'factory:decomposing' ||
    state === 'factory:issues-created';

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || send.isPending) return;
    setErrorMsg(null);
    // Optimistic insert.
    const reply: OptimisticReply = {
      id: -Date.now(),
      body: trimmed,
      authorLogin: 'you',
      createdAt: new Date().toISOString(),
      __optimistic: true,
    };
    setOptimisticReplies((prev) => [...prev, reply]);
    send.mutate(trimmed);
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
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">05 · Grill</div>
        <h2 className="text-[18px] font-semibold text-fg leading-snug">Discover-lane chat</h2>
        <p className="text-[12.5px] text-fg-2 mt-1">
          The griller asks one question at a time until the scope is precise enough to draft a PRD.
        </p>
      </div>

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
            const agent = isAgentQuestion(c.body);
            const display = stripMarker(c.body);
            const isOptimistic = '__optimistic' in c && c.__optimistic === true;
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
              </li>
            );
          })}
        </ol>
      )}

      {grillingComplete ? (
        <div
          data-testid="grill-complete-footer"
          className="text-[12px] text-fg-2 italic border-t border-line pt-3"
        >
          Grilling complete — the PRD has been drafted. Open the PRD tab to review it.
        </div>
      ) : (
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
          <div className="flex justify-end">
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
      )}
    </div>
  );
}
