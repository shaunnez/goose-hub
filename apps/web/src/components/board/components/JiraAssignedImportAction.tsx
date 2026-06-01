import { type JiraAssignedImportResponseDto, importAssignedJiraIssues } from '@/lib/api';
import { Download } from 'lucide-react';
import { useState } from 'react';

interface JiraAssignedImportActionProps {
  projectSlug: string;
  milestoneNumber?: number | null;
  onImported: () => void;
}

export function JiraAssignedImportAction({
  projectSlug,
  milestoneNumber,
  onImported,
}: JiraAssignedImportActionProps) {
  const [result, setResult] = useState<JiraAssignedImportResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function runImport() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await importAssignedJiraIssues(projectSlug, { milestoneNumber });
      setResult(response);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void runImport()}
        disabled={submitting}
        data-testid="jira-assigned-import-submit"
        className="inline-flex h-6 items-center gap-1.5 rounded border border-line px-2 text-[12px] text-fg-2 hover:bg-bg-hover hover:text-fg disabled:opacity-60"
      >
        <Download size={12} /> {submitting ? 'Importing...' : 'Import my Jira issues'}
      </button>
      {result != null && (
        <div
          data-testid="jira-assigned-import-result"
          className="flex max-w-[560px] items-center gap-2 truncate text-[12px] text-fg-3"
        >
          <span>
            Imported {result.counts.imported} Updated {result.counts.updated} Skipped{' '}
            {result.counts.skipped} Stale {result.counts.stale} Failed {result.counts.failed}
          </span>
          {result.failures.length > 0 && (
            <span className="truncate text-[color:var(--danger)]">
              {result.failures.map((failure) => `${failure.jiraKey}: ${failure.error}`).join('; ')}
            </span>
          )}
        </div>
      )}
      {error != null && (
        <div
          data-testid="jira-assigned-import-error"
          className="max-w-[360px] truncate text-[12px] text-[color:var(--danger)]"
        >
          {error}
        </div>
      )}
    </div>
  );
}
