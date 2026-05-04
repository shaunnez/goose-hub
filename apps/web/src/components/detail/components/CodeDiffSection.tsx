import { type IssueDiffDto, fetchEvents, fetchIssueDiff } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';

interface CodeDiffSectionProps {
  projectSlug: string;
  id: string;
}

const POLL_INTERVAL_MS = 5000;

// ─── Diff parser ─────────────────────────────────────────────────────────────

interface ParsedLine {
  kind: 'add' | 'del' | 'ctx';
  content: string;
  leftLine: number | null;
  rightLine: number | null;
}

interface ParsedHunk {
  header: string;
  lines: ParsedLine[];
}

interface ParsedFile {
  path: string;
  status: 'new' | 'mod' | 'del';
  adds: number;
  dels: number;
  hunks: ParsedHunk[];
}

function parseDiff(raw: string): ParsedFile[] {
  const lines = raw.split('\n');
  const files: ParsedFile[] = [];
  let cur: ParsedFile | null = null;
  let curHunk: ParsedHunk | null = null;
  let leftLine = 0;
  let rightLine = 0;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(cur);
      const m = line.match(/^diff --git a\/.+ b\/(.+)$/);
      cur = { path: m ? m[1] : line.slice(11), status: 'mod', adds: 0, dels: 0, hunks: [] };
      curHunk = null;
      continue;
    }
    if (cur == null) continue;
    if (line.startsWith('new file mode')) {
      cur.status = 'new';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      cur.status = 'del';
      continue;
    }
    if (
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('index ') ||
      line.startsWith('Binary ')
    )
      continue;

    if (line.startsWith('@@ ')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      leftLine = m ? Number.parseInt(m[1], 10) : 0;
      rightLine = m ? Number.parseInt(m[2], 10) : 0;
      curHunk = { header: line, lines: [] };
      cur.hunks.push(curHunk);
      continue;
    }

    if (curHunk == null) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      curHunk.lines.push({
        kind: 'add',
        content: line.slice(1),
        leftLine: null,
        rightLine: rightLine++,
      });
      cur.adds++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      curHunk.lines.push({
        kind: 'del',
        content: line.slice(1),
        leftLine: leftLine++,
        rightLine: null,
      });
      cur.dels++;
    } else if (line.startsWith(' ') || line === '') {
      curHunk.lines.push({
        kind: 'ctx',
        content: line.slice(1),
        leftLine: leftLine++,
        rightLine: rightLine++,
      });
    }
  }

  if (cur) files.push(cur);
  return files;
}

// ─── Component ───────────────────────────────────────────────────────────────

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
      <div data-testid="code-diff-empty" className="px-8 py-10 text-center text-[13px]">
        {prUrl != null ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[color:var(--accent)] hover:underline"
          >
            View PR{prNumber != null ? ` #${prNumber}` : ''} on GitHub
            <ExternalLink size={12} />
          </a>
        ) : (
          <span className="text-fg-3">{data?.reason ?? 'No active worktree for this issue.'}</span>
        )}
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
          <span className="text-fg-4 text-[11px]">{files.length} files</span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--success)' }}>
            +{totalAdds}
          </span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--danger)' }}>
            −{totalDels}
          </span>
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
            <span className="font-mono text-[10.5px] text-fg-4">run:{data.runId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      {/* Two-panel layout */}
      <div
        data-testid="code-diff-panels"
        style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 400 }}
      >
        {/* File list */}
        <div className="overflow-y-auto" style={{ borderRight: '1px solid var(--line)' }}>
          <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-4">
              Files · {files.length}
            </span>
          </div>
          {files.map((f) => {
            const isActive = currentFile?.path === f.path;
            const filename = f.path.split('/').at(-1) ?? f.path;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => setActiveFile(f.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  width: '100%',
                  padding: '6px 12px',
                  border: 'none',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 700,
                    width: 12,
                    flexShrink: 0,
                    color:
                      f.status === 'new'
                        ? 'var(--success)'
                        : f.status === 'del'
                          ? 'var(--danger)'
                          : 'var(--warning)',
                  }}
                >
                  {f.status === 'new' ? 'A' : f.status === 'del' ? 'D' : 'M'}
                </span>
                <span
                  className="truncate"
                  style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: isActive ? 'var(--fg)' : 'var(--fg-2)',
                  }}
                  title={f.path}
                >
                  {filename}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--success)',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}
                >
                  +{f.adds}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--danger)',
                    flexShrink: 0,
                  }}
                >
                  −{f.dels}
                </span>
              </button>
            );
          })}
        </div>

        {/* Diff viewer */}
        {currentFile != null && (
          <div className="min-w-0 flex flex-col overflow-auto">
            {/* File path header */}
            <div
              className="flex items-center justify-between px-4 py-2 shrink-0"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <span
                className="truncate"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)' }}
                title={currentFile.path}
              >
                {currentFile.path}
              </span>
              <span
                className="shrink-0 ml-4"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
              >
                <span style={{ color: 'var(--success)' }}>+{currentFile.adds}</span>{' '}
                <span style={{ color: 'var(--danger)' }}>−{currentFile.dels}</span>
              </span>
            </div>

            {/* Hunks */}
            <div
              data-testid="code-diff-pre"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.55,
                overflowX: 'auto',
              }}
            >
              {currentFile.hunks.length === 0 && (
                <div className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--fg-4)' }}>
                  No hunks
                </div>
              )}
              {currentFile.hunks.map((hunk) => (
                <div key={hunk.header}>
                  {/* Hunk meta */}
                  <div
                    style={{
                      padding: '5px 16px',
                      color: 'var(--fg-3)',
                      background: 'var(--bg-elev)',
                      whiteSpace: 'pre',
                    }}
                  >
                    {hunk.header}
                  </div>
                  {/* Hunk lines */}
                  {hunk.lines.map((line) => (
                    <div
                      key={`${line.leftLine ?? 'n'}-${line.rightLine ?? 'n'}-${line.kind}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '42px 42px 16px 1fr',
                        background:
                          line.kind === 'add'
                            ? 'oklch(0.68 0.16 156 / 0.12)'
                            : line.kind === 'del'
                              ? 'oklch(0.65 0.20 28 / 0.12)'
                              : 'transparent',
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--fg-4)',
                          textAlign: 'right',
                          paddingRight: 8,
                          userSelect: 'none',
                          borderRight: '1px solid var(--line)',
                        }}
                      >
                        {line.leftLine ?? ''}
                      </span>
                      <span
                        style={{
                          color: 'var(--fg-4)',
                          textAlign: 'right',
                          paddingRight: 8,
                          userSelect: 'none',
                          borderRight: '1px solid var(--line)',
                        }}
                      >
                        {line.rightLine ?? ''}
                      </span>
                      <span
                        style={{
                          textAlign: 'center',
                          userSelect: 'none',
                          color:
                            line.kind === 'add'
                              ? 'var(--success)'
                              : line.kind === 'del'
                                ? 'var(--danger)'
                                : 'var(--fg-4)',
                        }}
                      >
                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                      </span>
                      <span
                        style={{
                          whiteSpace: 'pre',
                          paddingLeft: 8,
                          color: line.kind === 'ctx' ? 'var(--fg-2)' : 'var(--fg)',
                          overflowX: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {line.content || ' '}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
