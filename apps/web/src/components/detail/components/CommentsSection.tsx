import { fetchComments } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { IssueCommentDto } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CommentComposer } from './CommentComposer';

const GRILL_QUESTION_MARKER = '<!-- factory:grill-question -->';
const FACTORY_MARKER_RE = /^<!--\s*factory:[^>]*-->\s*/;

function displayAuthor(c: IssueCommentDto): string {
  return c.body.startsWith(GRILL_QUESTION_MARKER) ? 'griller' : c.authorLogin;
}

function displayBody(body: string): string {
  return body.replace(FACTORY_MARKER_RE, '');
}

interface CommentsSectionProps {
  projectSlug: string;
  id: string;
  externalId: string;
}

export function CommentsSection({ projectSlug, id, externalId }: CommentsSectionProps) {
  const [newestFirst, setNewestFirst] = useState(true);

  const { data: comments = [], isLoading } = useQuery<IssueCommentDto[]>({
    queryKey: ['comments', projectSlug, id],
    queryFn: () => fetchComments(projectSlug, id),
  });

  const sorted = newestFirst ? [...comments].reverse() : [...comments];

  return (
    <div className="px-3 py-2" data-testid="comments-section">
      <div className="flex items-center gap-1 mb-2">
        <span className="text-[12px] font-medium text-fg-2">Comments</span>
        {comments.length > 0 && <span className="text-[12px] text-fg-2">({comments.length})</span>}
      </div>
      {comments.length > 1 && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={() => setNewestFirst((v) => !v)}
            className="text-[11px] text-fg-2 hover:text-fg-2 transition-colors"
            data-testid="sort-order-toggle"
          >
            {newestFirst ? 'Oldest first' : 'Newest first'}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-[12.5px] text-fg-2">Loading…</p>
      ) : (
        <div className="relative">
          {comments.length > 0 && (
            <div className="absolute left-[11px] top-2 bottom-2 w-px bg-line" />
          )}

          <div className="flex flex-col gap-2">
            {sorted.map((c) => {
              const isGrillQuestion = c.body.startsWith(GRILL_QUESTION_MARKER);
              return (
                <div key={c.id} className="relative pl-7">
                  <div className="absolute left-[5px] top-[11px] w-[11px] h-[11px] rounded-full border border-line-2 bg-bg-elev" />
                  <div
                    className={`rounded-md border overflow-hidden ${isGrillQuestion ? 'border-accent/30' : 'border-line'}`}
                  >
                    <div
                      className={`flex items-center justify-between px-3 py-1.5 border-b ${isGrillQuestion ? 'bg-accent-soft/20 border-accent/20' : 'bg-bg-elev border-line'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-fg-2">
                          {displayAuthor(c)}
                        </span>
                        <span className="text-[11px] text-fg-2">{timeAgo(c.createdAt)}</span>
                      </div>
                    </div>
                    <div
                      className="prose-fix px-3 py-2 text-[12.5px]"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: output of renderMarkdownToHtml which escapes raw input
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdownToHtml(displayBody(c.body)),
                      }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="relative pl-7">
              <div className="absolute left-[5px] top-[11px] w-[11px] h-[11px] rounded-full border-2 border-accent bg-bg" />
              <CommentComposer projectSlug={projectSlug} externalId={externalId} issueId={id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
