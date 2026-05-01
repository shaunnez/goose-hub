import type { IssueCommentDto, WorkItemDto } from '@/lib/types';
import { addComment, fetchComments } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

interface OverviewSectionProps {
  item?: WorkItemDto;
  projectSlug?: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function applyFormat(
  ta: HTMLTextAreaElement,
  setValue: (v: string) => void,
  prefix: string,
  suffix: string,
  placeholder: string,
) {
  const { selectionStart: ss, selectionEnd: se, value } = ta;
  const selected = value.slice(ss, se) || placeholder;
  const newValue = value.slice(0, ss) + prefix + selected + suffix + value.slice(se);
  setValue(newValue);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(ss + prefix.length, ss + prefix.length + selected.length);
  });
}

const TOOLBAR = [
  { label: 'B', prefix: '**', suffix: '**', placeholder: 'bold', title: 'Bold', cls: 'font-bold' },
  { label: 'I', prefix: '*', suffix: '*', placeholder: 'italic', title: 'Italic', cls: 'italic' },
  { label: '`', prefix: '`', suffix: '`', placeholder: 'code', title: 'Inline code', cls: 'font-mono' },
  { label: '```', prefix: '```\n', suffix: '\n```', placeholder: 'code block', title: 'Code block', cls: 'font-mono' },
  { label: 'link', prefix: '[', suffix: '](url)', placeholder: 'text', title: 'Link', cls: '' },
  { label: '- ', prefix: '\n- ', suffix: '', placeholder: '', title: 'List item', cls: 'font-mono' },
] as const;

function CommentComposer({
  projectSlug,
  externalId,
  issueId,
}: {
  projectSlug: string;
  externalId: string;
  issueId: string;
}) {
  const queryClient = useQueryClient();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await addComment(projectSlug, externalId, trimmed);
      setText('');
      setTab('write');
      void queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, issueId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="rounded-md border border-line overflow-hidden">
      {/* Tab bar + toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-bg-elev border-b border-line">
        <div className="flex gap-0.5">
          {(['write', 'preview'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-[12px] rounded capitalize transition-none ${
                tab === t
                  ? 'bg-bg text-fg-2 border border-line shadow-sm'
                  : 'text-fg-4 hover:text-fg-2'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'write' && (
          <div className="flex items-center gap-px">
            {TOOLBAR.map(({ label, prefix, suffix, placeholder, title, cls }) => (
              <button
                key={title}
                type="button"
                title={title}
                onClick={() => {
                  if (taRef.current) applyFormat(taRef.current, setText, prefix, suffix, placeholder);
                }}
                className={`px-2 py-0.5 text-[11.5px] text-fg-3 hover:text-fg-2 hover:bg-bg-hover rounded ${cls}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      {tab === 'write' ? (
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a comment…"
          rows={5}
          className="w-full min-h-[120px] bg-bg text-[13px] px-4 py-3 resize-y focus:outline-none placeholder:text-fg-4 block"
        />
      ) : (
        <div
          className="prose-fix px-4 py-3 text-[13px] min-h-[120px]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: output of renderMarkdownToHtml which escapes raw input
          dangerouslySetInnerHTML={{
            __html: text.trim()
              ? renderMarkdownToHtml(text)
              : '<p style="color:var(--fg-4);font-size:13px">Nothing to preview</p>',
          }}
        />
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-line bg-bg-elev">
        <button
          type="submit"
          disabled={saving || !text.trim()}
          className="h-7 px-4 rounded text-[12px] bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Comment'}
        </button>
        {error != null && <span className="text-[11.5px] text-danger">{error}</span>}
      </div>
    </form>
  );
}

function CommentsSection({
  projectSlug,
  id,
  externalId,
}: {
  projectSlug: string;
  id: string;
  externalId: string;
}) {
  const { data: comments = [], isLoading } = useQuery<IssueCommentDto[]>({
    queryKey: ['comments', projectSlug, id],
    queryFn: () => fetchComments(projectSlug, id),
  });

  return (
    <div className="mt-8">
      <h2 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-4">
        Comments {comments.length > 0 && <span className="text-fg-4">({comments.length})</span>}
      </h2>

      {isLoading ? (
        <p className="text-[12.5px] text-fg-4">Loading…</p>
      ) : (
        <div className="relative">
          {/* Vertical timeline line */}
          {(comments.length > 0) && (
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-line" />
          )}

          <div className="flex flex-col gap-4">
            {comments.map((c) => (
              <div key={c.id} className="relative pl-8">
                {/* Timeline dot */}
                <div className="absolute left-[5px] top-[13px] w-[13px] h-[13px] rounded-full border border-line-2 bg-bg-elev" />

                {/* Card */}
                <div className="rounded-md border border-line overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-bg-elev border-b border-line">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium text-fg-2">{c.authorLogin}</span>
                      <span className="text-[11.5px] text-fg-4">{timeAgo(c.createdAt)}</span>
                    </div>
                  </div>
                  <div
                    className="prose-fix px-4 py-3 text-[13px]"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: output of renderMarkdownToHtml which escapes raw input
                    dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(c.body) }}
                  />
                </div>
              </div>
            ))}

            {/* Composer */}
            <div className="relative pl-8">
              <div className="absolute left-[5px] top-[13px] w-[13px] h-[13px] rounded-full border-2 border-accent bg-bg" />
              <CommentComposer
                projectSlug={projectSlug}
                externalId={externalId}
                issueId={id}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function OverviewSection({ item, projectSlug }: OverviewSectionProps) {
  const html = renderMarkdownToHtml(item?.body || '');
  return (
    <div data-testid="overview-section" className="px-8 py-6 max-w-[920px]">
      <div className="flex flex-wrap gap-1.5 mb-5">
        {item?.dependsOn && item?.dependsOn.length > 0 && (
          <div className="text-[12px] text-fg-3">
            <span className="font-medium text-fg-2">Depends on:</span>{' '}
            {item?.dependsOn.map((d, i) => (
              <span key={d} className="font-mono">
                #{d}
                {i < item.dependsOn.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        )}
        {item?.blocks && item.blocks.length > 0 && (
          <div className="text-[12px] text-fg-3 ml-4">
            <span className="font-medium text-fg-2">Blocks:</span>{' '}
            {item.blocks.map((d, i) => (
              <span key={d} className="font-mono">
                #{d}
                {i < item.blocks.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <article
        data-testid="overview-body"
        className="prose-fix text-[13.5px]"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated by renderMarkdownToHtml which escapes raw input.
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {item != null && projectSlug != null && (
        <CommentsSection
          projectSlug={projectSlug}
          id={item.externalId}
          externalId={item.externalId}
        />
      )}
    </div>
  );
}
