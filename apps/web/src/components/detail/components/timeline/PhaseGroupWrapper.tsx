import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RenderItem, TimelineContext } from '../../lib/timeline';
import { formatDuration } from '../../lib/timeline';

interface PhaseGroupWrapperProps {
  phase: string;
  label: string;
  items: RenderItem[];
  startedAt: string | null;
  endedAt: string | null;
  context?: TimelineContext;
  renderItem: (item: RenderItem, idx: number, context?: TimelineContext) => React.ReactNode;
}

export function PhaseGroupWrapper({
  label,
  items,
  startedAt,
  endedAt,
  context,
  renderItem,
}: PhaseGroupWrapperProps) {
  const [open, setOpen] = useState(false);

  const expandTick = context?.expandSignal?.tick ?? 0;
  const expandOpen = context?.expandSignal?.open ?? true;
  useEffect(() => {
    if (expandTick === 0) return;
    setOpen(expandOpen);
  }, [expandTick, expandOpen]);

  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const duration = startMs != null && endMs != null ? formatDuration(endMs - startMs) : null;

  const totalEvents = items.reduce((sum, item) => {
    if (item.kind === 'run-group') return sum + item.items.length;
    return sum + 1;
  }, 0);

  const hasFailed = items.some(
    (item) =>
      item.kind === 'run-group' &&
      item.items.some((c) => c.kind === 'event' && c.event.kind === 'agent.run-failed'),
  );

  const isLive = endedAt == null;

  const statusBadge = isLive ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      Live
    </span>
  ) : hasFailed ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
      Failed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
      Complete
    </span>
  );

  return (
    <li data-phase-group className="rounded-md border border-line bg-bg/30">
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-semibold tracking-wider uppercase text-fg-2">{label}</span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          {statusBadge}
          {duration != null && (
            <span className="text-fg-5 text-[10.5px]">
              {duration}
              {startedAt != null && (
                <> &middot; Started {new Date(startedAt).toLocaleTimeString()}</>
              )}
              {endedAt != null && <> &middot; Ended {new Date(endedAt).toLocaleTimeString()}</>}
            </span>
          )}
          <span className="ml-auto text-fg-5">
            {items.length} runs · {totalEvents} events
          </span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {items.map((item, i) => renderItem(item, i, context))}
        </ol>
      </details>
    </li>
  );
}
