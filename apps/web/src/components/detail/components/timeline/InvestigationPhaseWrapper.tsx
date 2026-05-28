import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RenderItem, TimelineContext } from '../../lib/timeline';
import { formatDuration } from '../../lib/timeline';

const STALL_MS = 15 * 60 * 1000;

export function InvestigationPhaseWrapper({
  investigationRunId,
  items,
  status,
  startedAt,
  endedAt,
  lastEventAt,
  context,
  renderItem,
}: {
  investigationRunId: string;
  items: RenderItem[];
  status: 'started' | 'live' | 'completed' | 'failed';
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  context?: TimelineContext;
  renderItem: (item: RenderItem, idx: number, context?: TimelineContext) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isActive = status === 'started' || status === 'live';
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const expandTick = context?.expandSignal?.tick ?? 0;
  const expandOpen = context?.expandSignal?.open ?? true;
  useEffect(() => {
    if (expandTick === 0) return;
    setOpen(expandOpen);
  }, [expandTick, expandOpen]);

  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const lastMs = lastEventAt != null ? new Date(lastEventAt).getTime() : null;
  const isStalled = isActive && lastMs != null && now - lastMs > STALL_MS;
  const activeDuration = startMs != null ? formatDuration(now - startMs) : null;
  const completeDuration =
    startMs != null && endMs != null ? formatDuration((lastMs ?? endMs) - startMs) : null;
  const shortId =
    investigationRunId.length > 8 ? investigationRunId.slice(0, 8) : investigationRunId;

  const statusBadge = isStalled ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
      Stalled
    </span>
  ) : status === 'failed' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
      Failed
    </span>
  ) : status === 'completed' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
      Complete
    </span>
  ) : status === 'started' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[color:var(--accent)]/10 text-[color:var(--accent)] border border-[color:var(--accent)]/25">
      Started
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      Live
    </span>
  );

  const metaLine = isStalled ? (
    <span className="text-yellow-400/70 text-[10.5px]">
      no activity for {lastMs != null ? formatDuration(now - lastMs) : '?'}
    </span>
  ) : isActive ? (
    activeDuration != null ? (
      <span className="text-fg-5 text-[10.5px]">running for {activeDuration}</span>
    ) : null
  ) : (
    <span className="text-fg-5 text-[10.5px]">
      {completeDuration != null && <>Ran for {completeDuration}</>}
      {startedAt != null && <> &middot; Started {new Date(startedAt).toLocaleTimeString()}</>}
      {endedAt != null && (
        <> &middot; Ended {new Date(lastEventAt ?? endedAt).toLocaleTimeString()}</>
      )}
    </span>
  );

  return (
    <li
      data-investigation-run-id={investigationRunId}
      className="rounded-md border border-[color:var(--accent)]/20 bg-bg/30"
    >
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none flex-wrap">
          <span className="shrink-0">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="font-mono uppercase tracking-wider text-[color:var(--accent)] text-[10.5px]">
            Investigation Phase
          </span>
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="font-mono text-fg-5 text-[10.5px]">run {shortId}</span>
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="w-[72px] shrink-0 flex justify-start">{statusBadge}</span>
          <span className="flex-1 min-w-0 truncate">{metaLine}</span>
          <span className="ml-auto shrink-0 text-fg-5">{items.length} items</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {items.map((item, i) => renderItem(item, i, context))}
        </ol>
      </details>
    </li>
  );
}
