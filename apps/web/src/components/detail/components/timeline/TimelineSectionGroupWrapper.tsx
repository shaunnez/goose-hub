import { TIMELINE_SECTION_DEFINITIONS } from '@goose-hub/core/workflows/timeline-sections.js';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { RenderItem, TimelineContext } from '../../lib/timeline';
import { collectBillableRunIdsForTimelineSection, formatDuration } from '../../lib/timeline';
import { CostBadge } from '../CostBadge';

const SECTION_TITLE = new Map(
  TIMELINE_SECTION_DEFINITIONS.map((section) => [section.id, section.title]),
);

export function TimelineSectionGroupWrapper({
  section,
  items,
  startedAt,
  endedAt,
  lastEventAt,
  context,
  renderItem,
}: Omit<Extract<RenderItem, { kind: 'timeline-section' }>, 'kind'> & {
  context?: TimelineContext;
  renderItem: (item: RenderItem, idx: number, context?: TimelineContext) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const expandTick = context?.expandSignal?.tick ?? 0;
  const expandOpen = context?.expandSignal?.open ?? true;

  useEffect(() => {
    if (expandTick === 0) return;
    setOpen(expandOpen);
  }, [expandTick, expandOpen]);

  const costs = useMemo(() => {
    const runIds = collectBillableRunIdsForTimelineSection(section, items);
    let tokens = 0;
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let cacheCreationInputTokens = 0;
    let reasoningOutputTokens = 0;
    let usd = 0;
    let estimated = false;
    for (const runId of runIds) {
      const row = context?.runCosts?.get(runId);
      if (row == null) continue;
      tokens += row.inputTokens + row.outputTokens;
      inputTokens += row.inputTokens;
      cachedInputTokens += row.cachedInputTokens;
      cacheCreationInputTokens += row.cacheCreationInputTokens;
      reasoningOutputTokens += row.reasoningOutputTokens;
      usd += row.costUsd;
      estimated = estimated || row.costLabel === 'estimated';
    }
    return {
      tokens,
      usd,
      cacheHitRatio: cachedInputTokens / Math.max(inputTokens, 1),
      cacheCreationInputTokens,
      reasoningOutputTokens,
      label: estimated ? ('estimated' as const) : ('exact' as const),
    };
  }, [section, items, context?.runCosts]);

  const title = SECTION_TITLE.get(section) ?? section;
  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const lastMs = lastEventAt != null ? new Date(lastEventAt).getTime() : null;
  const duration =
    startMs != null && (lastMs != null || endMs != null)
      ? formatDuration((lastMs ?? endMs ?? startMs) - startMs)
      : null;

  return (
    <li
      data-timeline-section={section}
      className="rounded-md border border-line/70 bg-bg-subtle/40"
    >
      <details
        open={open}
        onToggle={(event) => {
          event.stopPropagation();
          setOpen((event.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none flex-wrap">
          <span className="shrink-0">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="w-[150px] shrink-0 uppercase tracking-wider text-fg text-[10.5px]">
            {title}
          </span>
          {costs.tokens > 0 || costs.usd > 0 ? (
            <span className="shrink-0">
              <CostBadge
                tokens={costs.tokens}
                usd={costs.usd}
                label={costs.label}
                size="sm"
                cacheHitRatio={costs.cacheHitRatio}
                cacheCreationInputTokens={costs.cacheCreationInputTokens}
                reasoningOutputTokens={costs.reasoningOutputTokens}
              />
            </span>
          ) : null}
          <span className="flex-1 min-w-0 truncate text-fg-5 text-[10.5px]">
            {duration != null && <>Span {duration}</>}
            {startedAt != null && <> &middot; First {new Date(startedAt).toLocaleTimeString()}</>}
            {lastEventAt != null && (
              <> &middot; Last {new Date(lastEventAt).toLocaleTimeString()}</>
            )}
          </span>
          <span className="ml-auto shrink-0 text-fg-5">{items.length} groups</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {items.map((item, index) => renderItem(item, index, context))}
        </ol>
      </details>
    </li>
  );
}
