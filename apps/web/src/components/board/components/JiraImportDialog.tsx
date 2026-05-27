import { type JiraImportItemDto, importJiraIssue } from '@/lib/api';
import { X } from 'lucide-react';
import { type FormEvent, useState } from 'react';

interface JiraImportDialogProps {
  open: boolean;
  projectSlug: string;
  milestoneNumber?: number | null;
  onClose: () => void;
  onImported: (item: JiraImportItemDto) => void;
}

export function JiraImportDialog({
  open,
  projectSlug,
  milestoneNumber,
  onClose,
  onImported,
}: JiraImportDialogProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (value.length === 0) {
      setError('input is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await importJiraIssue(projectSlug, value, { milestoneNumber });
      setInput('');
      onImported(result.item);
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
      data-testid="jira-import-dialog"
    >
      <div className="w-full max-w-[420px] rounded-md border border-line bg-bg-elev shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-fg">Import Jira Issue</h2>
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
            Jira key or URL
            <input
              data-testid="jira-import-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="TAS-123"
              className="h-8 rounded border border-line bg-bg px-2 text-[13px] text-fg outline-none focus:border-accent-line"
            />
          </label>
          {error != null && (
            <div
              data-testid="jira-import-error"
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
              data-testid="jira-import-submit"
              disabled={submitting}
              className="h-8 rounded border border-accent-line bg-[color:var(--accent)]/15 px-3 text-[12px] font-medium text-[color:var(--accent)] hover:bg-[color:var(--accent)]/20 disabled:opacity-60"
            >
              {submitting ? 'Importing...' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
