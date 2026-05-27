import { createLocalIssue } from '@/lib/api';
import type { WorkItemDto } from '@/lib/types';
import { X } from 'lucide-react';
import { type FormEvent, useState } from 'react';

interface NewLocalIssueDialogProps {
  open: boolean;
  projectSlug: string;
  milestoneNumber?: number | null;
  onClose: () => void;
  onCreated: (item: WorkItemDto) => void;
}

export function NewLocalIssueDialog({
  open,
  projectSlug,
  milestoneNumber,
  onClose,
  onCreated,
}: NewLocalIssueDialogProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('feature');
  const [priority, setPriority] = useState('medium');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setError('title is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createLocalIssue(projectSlug, {
        title: trimmedTitle,
        body,
        type,
        priority,
        ...(milestoneNumber != null ? { milestoneNumber } : {}),
      });
      setTitle('');
      setBody('');
      setType('feature');
      setPriority('medium');
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      data-testid="new-local-issue-dialog"
    >
      <div className="w-full max-w-[460px] rounded-md border border-line bg-bg-elev shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-fg">New Local Work Item</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded text-fg-3 hover:bg-bg-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        </header>
        <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-8 rounded border border-line bg-bg px-2 text-[13px] text-fg outline-none focus:border-accent-line"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
            Body
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              className="min-h-[110px] rounded border border-line bg-bg px-2 py-2 text-[13px] text-fg outline-none focus:border-accent-line"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value)}
                className="h-8 rounded border border-line bg-bg px-2 text-[13px] text-fg outline-none focus:border-accent-line"
              >
                <option value="feature">Feature</option>
                <option value="bug">Bug</option>
                <option value="chore">Chore</option>
                <option value="research">Research</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
              Priority
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="h-8 rounded border border-line bg-bg px-2 text-[13px] text-fg outline-none focus:border-accent-line"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
          {error != null && (
            <div
              data-testid="new-local-issue-error"
              className="rounded border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/10 px-3 py-2 text-[12px] text-[color:var(--danger)]"
            >
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded border border-line px-3 text-[12px] text-fg-2 hover:bg-bg-hover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-8 rounded border border-accent-line bg-[color:var(--accent)]/15 px-3 text-[12px] font-medium text-[color:var(--accent)] hover:bg-[color:var(--accent)]/20 disabled:opacity-60"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
