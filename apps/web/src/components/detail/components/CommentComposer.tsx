import { MarkdownEditor } from '@/components/ui/MarkdownEditor';
import { addComment } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface CommentComposerProps {
  projectSlug: string;
  externalId: string;
  issueId: string;
}

export function CommentComposer({ projectSlug, externalId, issueId }: CommentComposerProps) {
  const queryClient = useQueryClient();
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
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="rounded-md border border-line overflow-hidden"
      data-testid="comment-composer"
    >
      <MarkdownEditor
        value={text}
        onChange={setText}
        tab={tab}
        onTabChange={setTab}
        placeholder="Leave a comment…"
        rows={5}
      />
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-line bg-bg-elev">
        <button
          type="submit"
          disabled={saving || !text.trim()}
          data-testid="comment-submit"
          className="h-7 px-4 rounded text-[12px] bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Comment'}
        </button>
        {error != null && <span className="text-[11.5px] text-danger">{error}</span>}
      </div>
    </form>
  );
}
