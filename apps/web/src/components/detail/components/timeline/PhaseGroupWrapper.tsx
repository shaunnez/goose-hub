import type { RenderItem, TimelineContext } from '../../lib/timeline';
import { formatDuration } from '../../lib/timeline';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PhaseGroupWrapper({
  pipelineRunId,
  items,
  startedAt,
  endedAt,
  context,
  renderItem,
}: {
  pipelineRunId: string;
  items: RenderItem[];
  startedAt: string | null;
  endedAt: string | null;
  context?: TimelineContext;
  renderItem: (item: RenderItem, idx: number, context?: TimelineContext) => React.ReactNode;
}) {
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
  const shortId = pipelineRunId.length > 8 ? pipelineRunId.slice(0, 8) : pipelineRunId;

  return (
    <li data-pipeline-run-id={pipelineRunId} className="rounded-md border border-[color:var(--accent)]/20 bg-bg/30">
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none">
          <span className="shrink-0">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="font-mono uppercase tracking-wider text-[color:var(--accent)] text-[10.5px]">
            Dev Phase
          </span>
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="font-mono text-fg-5 text-[10.5px]">pipeline {shortId}</span>
          {duration != null && (
            <>
              <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
              <span className="text-fg-5 text-[10.5px]">{duration}</span>
            </>
          )}
          {startedAt != null && (
            <>
              <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
              <span className="text-fg-5 text-[10.5px]">
                Started {new Date(startedAt).toLocaleTimeString()}
              </span>
            </>
          )}
          <span className="ml-auto shrink-0 text-fg-5">{items.length} events</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {items.map((item, i) => renderItem(item, i, context))}
        </ol>
      </details>
    </li>
  );
}
