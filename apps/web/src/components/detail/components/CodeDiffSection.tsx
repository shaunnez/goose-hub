import { type IssueDiffDto, fetchEvents, fetchIssueDiff } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

interface CodeDiffSectionProps {
  projectSlug: string;
  id: string;
}

const POLL_INTERVAL_MS = 5000;

/**
 * Live diff for the Code tab (#185). Polls the worktree-diff endpoint
 * every 5 s. Renders a unified diff with line-prefix colouring; falls
 * back to an empty state when no worktree exists.
 *
 * Read-only — no editing from the UI.
 */
export function CodeDiffSection({ projectSlug, id }: CodeDiffSectionProps) {
  const { data, isLoading, isError } = useQuery<IssueDiffDto>({
    queryKey: ['issue-diff', projectSlug, id],
    queryFn: () => fetchIssueDiff(projectSlug, id),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const { data: events } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
    staleTime: 10_000,
  });
  const prOpenedEvent = events?.findLast(
    (e): e is AgentEventDto & { payload: { prNumber: number; prUrl: string } } =>
      e.kind === 'pr.opened' && typeof (e.payload as Record<string, unknown>)?.prUrl === 'string',
  );
  const prUrl = prOpenedEvent != null ? (prOpenedEvent.payload as { prUrl: string }).prUrl : null;
  const prNumber =
    prOpenedEvent != null ? (prOpenedEvent.payload as { prNumber?: number }).prNumber : null;

  if (isLoading) {
    return (
      <div data-testid="code-diff-loading" className="px-8 py-10 text-center text-fg-3 text-[13px]">
        Loading diff…
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="code-diff-error" className="px-8 py-10 text-center text-fg-3 text-[13px]">
        Failed to load diff. Will retry shortly.
      </div>
    );
  }

  if (data == null || data.diff == null || data.diff.length === 0) {
    if (prUrl != null) {
      return (
        <div data-testid="code-diff-pr" className="px-8 py-10 text-center text-[13px]">
          <div className="text-fg-3 mb-2">Worktree closed — PR opened.</div>
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--accent)] hover:underline"
          >
            View PR{prNumber != null ? ` #${prNumber}` : ''} on GitHub
          </a>
        </div>
      );
    }
    return (
      <div data-testid="code-diff-empty" className="px-8 py-10 text-center text-fg-3 text-[13px]">
        {data?.reason ?? 'No active worktree for this issue.'}
      </div>
    );
  }

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between text-fg-3 text-[12px]">
        <div>
          Live worktree diff
          {data.runId != null ? (
            <span className="ml-2 font-mono text-[11px]">run: {data.runId.slice(0, 8)}</span>
          ) : null}
        </div>
        <div className="text-fg-4">refreshing every {POLL_INTERVAL_MS / 1000}s</div>
      </div>
      <pre
        data-testid="code-diff-pre"
        className="overflow-x-auto rounded-md border border-line bg-bg-elev p-3 font-mono text-[12px] leading-relaxed"
      >
        {data.diff.split('\n').map((line, idx) => (
          <DiffLine key={`${idx}-${line.slice(0, 16)}`} line={line} />
        ))}
      </pre>
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  let className = 'text-fg-2';
  if (line.startsWith('+++') || line.startsWith('---')) className = 'text-fg-3 font-semibold';
  else if (line.startsWith('@@')) className = 'text-blue-400';
  else if (line.startsWith('+')) className = 'text-green-400';
  else if (line.startsWith('-')) className = 'text-red-400';
  else if (line.startsWith('diff --git')) className = 'text-fg-3 font-semibold mt-3 block';
  return (
    <div className={className} data-testid="code-diff-line">
      {line || ' '}
    </div>
  );
}
