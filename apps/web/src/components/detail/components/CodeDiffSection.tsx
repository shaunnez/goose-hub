import { fetchEvents, fetchIssueDiff } from '@/lib/api';
import type { AgentEventDto, IssueDiffDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileCode } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseDiff } from '../lib/code-diff';
import { useIssueCostsBreakdown } from '../lib/costs';
import { CodeDiffFileList } from './CodeDiffFileList';
import { CodeDiffViewer } from './CodeDiffViewer';
import { CostBadge } from './CostBadge';
import { SectionEmptyState } from './SectionEmptyState';

interface CodeDiffSectionProps {
  projectSlug: string;
  id: string;
}

const POLL_INTERVAL_MS = 5000;

export function CodeDiffSection({ projectSlug, id }: CodeDiffSectionProps) {
  const [activeFile, setActiveFile] = useState<string | null>(null);

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

  const { byStage } = useIssueCostsBreakdown(projectSlug, id);
  const devCost = byStage.get('dev');

  const prOpenedEvent = events
    ?.slice()
    .reverse()
    .find(
      (e): e is AgentEventDto & { payload: { prNumber: number; prUrl: string } } =>
        e.kind === 'pr.opened' && typeof (e.payload as Record<string, unknown>)?.prUrl === 'string',
    );
  const prUrl = prOpenedEvent != null ? (prOpenedEvent.payload as { prUrl: string }).prUrl : null;
  const prNumber =
    prOpenedEvent != null ? (prOpenedEvent.payload as { prNumber?: number }).prNumber : null;

  const files = useMemo(() => (data?.diff ? parseDiff(data.diff) : []), [data?.diff]);

  const currentFile =
    (activeFile != null ? files.find((f) => f.path === activeFile) : null) ?? files[0] ?? null;

  const totalAdds = useMemo(() => files.reduce((s, f) => s + f.adds, 0), [files]);
  const totalDels = useMemo(() => files.reduce((s, f) => s + f.dels, 0), [files]);

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

  if (files.length === 0) {
    return (
      <div className="px-8 py-10">
        <SectionEmptyState
          data-testid="code-diff-empty"
          icon={FileCode}
          title="No diff available"
          subtitle={data?.reason ?? 'No active worktree for this issue.'}
        >
          {prUrl != null && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--accent)] hover:underline"
            >
              View PR{prNumber != null ? ` #${prNumber}` : ''} on GitHub
              <ExternalLink size={12} />
            </a>
          )}
        </SectionEmptyState>
      </div>
    );
  }

  return (
    <div data-testid="code-diff-section">
      {/* Header bar */}
      <div className="px-6 py-2.5 flex items-center justify-between border-b border-line">
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-fg-3">
            {prNumber != null ? `PR #${prNumber}` : 'Live diff'}
          </span>
          <span className="text-fg-2 text-[11px]">{files.length} files</span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--success)' }}>
            +{totalAdds}
          </span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--danger)' }}>
            −{totalDels}
          </span>
          {devCost && (
            <CostBadge tokens={devCost.tokens} usd={devCost.usd} label={devCost.label} size="sm" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {prUrl != null && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] text-fg-3 hover:text-fg transition-colors"
            >
              <ExternalLink size={11} />
              GitHub
            </a>
          )}
          {prNumber == null && data?.runId != null && (
            <span className="font-mono text-[10.5px] text-fg-2">run:{data.runId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      {/* Two-panel layout */}
      <div
        data-testid="code-diff-panels"
        style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 400 }}
      >
        <CodeDiffFileList
          files={files}
          activePath={currentFile?.path ?? null}
          onSelect={setActiveFile}
        />
        {currentFile != null && <CodeDiffViewer file={currentFile} />}
      </div>
    </div>
  );
}
