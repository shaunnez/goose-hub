import { resumeIssue } from '@/lib/api';
import type { CostLabel, CostRowDto } from '@/lib/types';
import { getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type RenderItem,
  type TimelineContext,
  computeIsWritePrdStuck,
  formatDuration,
  formatSkillName,
  getAgentLogDisplayText,
  isCodexTransportWarningLog,
} from '../../lib/timeline';
import { CostBadge } from '../CostBadge';

const STALL_MS = 15 * 60 * 1000; // 15 minutes with no new events → stalled

export function RunGroupWrapper({
  runId,
  items,
  idx,
  skill,
  startedAt,
  endedAt,
  lastEventAt,
  personaId,
  modelId,
  runtime,
  context,
  renderItem,
}: {
  runId: string;
  items: RenderItem[];
  idx: number;
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  personaId: string | null;
  modelId: string | null;
  runtime: string | null;
  context?: TimelineContext;
  renderItem: (item: RenderItem, idx: number, context?: TimelineContext) => React.ReactNode;
}) {
  const personaMap = usePersonaMap();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [resuming, setResuming] = useState(false);
  const [resumed, setResumed] = useState(false);
  const isLive = endedAt == null;

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // React to expand/collapse all signal from parent.
  const expandTick = context?.expandSignal?.tick ?? 0;
  const expandOpen = context?.expandSignal?.open ?? true;
  useEffect(() => {
    if (expandTick === 0) return;
    setOpen(expandOpen);
  }, [expandTick, expandOpen]);

  const groupEventList = items
    .filter((item): item is Extract<RenderItem, { kind: 'event' }> => item.kind === 'event')
    .map((item) => item.event);
  const scoutSemanticEvent = [...groupEventList]
    .reverse()
    .find((event) =>
      [
        'swarm.scout-failed',
        'swarm.scout-timeout',
        'swarm.scout-skipped',
        'swarm.scout-completed',
      ].includes(event.kind),
    );
  const isFailed = groupEventList.some(
    (event) =>
      event.kind === 'agent.run-failed' ||
      event.kind === 'swarm.scout-failed' ||
      event.kind === 'swarm.scout-timeout' ||
      event.kind === 'qa.verification-blocked' ||
      event.kind === 'parallel-implement.exhausted' ||
      event.kind === 'parallel-implement.wp-failed' ||
      event.kind === 'parallel-implement.wp-timeout' ||
      event.kind === 'parallel-implement.wp-commit-failed' ||
      event.kind === 'parallel-implement.wp-terminal-blocked' ||
      /^qa\..*-failed$/.test(event.kind),
  );
  const codexTransportWarnings = groupEventList.filter(isCodexTransportWarningLog);
  const codexTransportWarning = codexTransportWarnings[0] ?? null;
  const warningRecovered = codexTransportWarning != null && endedAt != null && !isFailed;

  const displayItems = items
    .filter(
      (item) =>
        !(
          item.kind === 'event' &&
          codexTransportWarnings.some((event) => event.id === item.event.id)
        ),
    )
    .map((item) => {
      if (
        item.kind === 'event' &&
        (item.event.kind === 'agent.run-completed' || item.event.kind === 'agent.run-failed') &&
        lastEventAt != null
      ) {
        return { ...item, event: { ...item.event, createdAt: lastEventAt } };
      }
      return item;
    });
  const getItemTs = (item: RenderItem): number => {
    if (item.kind === 'event') {
      const base = new Date(item.event.createdAt).getTime();
      // +1 ensures run-completed/failed sorts above any same-timestamp sibling
      if (item.event.kind === 'agent.run-completed' || item.event.kind === 'agent.run-failed') {
        return base + 1;
      }
      return base;
    }
    if (item.kind === 'log-group') return new Date(item.events[0]?.createdAt ?? 0).getTime();
    return 0;
  };
  const sorted = [...displayItems].sort((a, b) => getItemTs(b) - getItemTs(a));

  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const lastMs = lastEventAt != null ? new Date(lastEventAt).getTime() : null;
  const isStalled = isLive && lastMs != null && now - lastMs > STALL_MS;
  const liveDuration = startMs != null ? formatDuration(now - startMs) : null;
  const completeDuration =
    startMs != null && endMs != null ? formatDuration((lastMs ?? endMs) - startMs) : null;
  const isOrphaned = items.some(
    (item) =>
      item.kind === 'event' &&
      item.event.kind === 'agent.run-failed' &&
      (item.event.payload as { orphaned?: boolean } | null)?.orphaned === true,
  );

  const isWritePrdStuck = computeIsWritePrdStuck(groupEventList);
  const isLatestRun = context?.latestRunId === runId;
  const canResume =
    context != null && (isFailed || isStalled || isWritePrdStuck) && isLatestRun && !resumed;

  const runCost = useMemo(
    () => aggregateRunGroupCosts(runId, groupEventList, context?.runCosts),
    [runId, groupEventList, context?.runCosts],
  );
  const runTokens = runCost ? runCost.inputTokens + runCost.outputTokens : 0;
  const displayModelId = runCost?.modelId ?? modelId;
  const displayRuntime = runtime ?? runCost?.provider ?? null;

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (context == null || resuming || resumed) return;
    setResuming(true);
    setResumed(true);
    try {
      await resumeIssue(context.slug, context.issueId);
    } finally {
      setResuming(false);
    }
  };

  const statusBadge =
    scoutSemanticEvent?.kind === 'swarm.scout-skipped' ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
        Skipped
      </span>
    ) : scoutSemanticEvent?.kind === 'swarm.scout-failed' ||
      scoutSemanticEvent?.kind === 'swarm.scout-timeout' ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
        {scoutSemanticEvent.kind === 'swarm.scout-timeout' ? 'Timeout' : 'Failed'}
      </span>
    ) : scoutSemanticEvent?.kind === 'swarm.scout-completed' ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
        Complete
      </span>
    ) : isStalled ? (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        Stalled
      </span>
    ) : isLive ? (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        Live
      </span>
    ) : isFailed ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
        {isOrphaned ? 'Orphaned' : 'Failed'}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
        Complete
      </span>
    );

  const metaLine =
    isLive && !isStalled ? (
      liveDuration != null ? (
        <span className="text-fg-5 text-[10.5px]">
          {startedAt != null && <>Started {new Date(startedAt).toLocaleTimeString()} &middot; </>}
          Running for {liveDuration}
        </span>
      ) : null
    ) : isStalled ? (
      <span className="text-yellow-400/70 text-[10.5px]">
        {startedAt != null && <>Started {new Date(startedAt).toLocaleTimeString()} &middot; </>}
        No activity for {lastMs != null ? formatDuration(now - lastMs) : '?'}
      </span>
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
    <li data-run-id={runId} className="rounded-md border border-line/70 bg-bg/30">
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
          <span title={runId} className="w-[160px] shrink-0 truncate">
            <span className="cursor-help border-b border-dashed border-fg-5/40">
              {formatSkillName(skill)} Run
            </span>
          </span>
          {getPersonaLabel(personaMap, personaId) != null && (
            <>
              <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
              <span className="w-[130px] shrink-0 truncate text-[color:var(--accent)] text-[10px]">
                {getPersonaLabel(personaMap, personaId)}
              </span>
            </>
          )}
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="w-[72px] shrink-0 flex justify-start">{statusBadge}</span>
          {runCost && (
            <span className="shrink-0">
              <CostBadge
                tokens={runTokens}
                usd={runCost.costUsd}
                label={runCost.costLabel}
                size="sm"
                cacheHitRatio={runCost.cacheHitRatio}
                reasoningOutputTokens={runCost.reasoningOutputTokens}
              />
            </span>
          )}
          {displayRuntime && (
            <span className="shrink-0 w-[62px] truncate px-1.5 py-0.5 rounded text-[10px] font-mono bg-fg-5/10 text-fg-4 border border-line/40">
              {displayRuntime}
            </span>
          )}
          {displayModelId && (
            <span className="shrink-0 w-[80px] truncate px-1.5 py-0.5 rounded text-[10px] font-mono bg-fg-5/10 text-fg-4 border border-line/40">
              {displayModelId.replace(/^claude-/, '')}
            </span>
          )}
          <span className="flex-1 min-w-0 truncate">{metaLine}</span>
          {canResume && (
            <button
              type="button"
              onClick={handleResume}
              disabled={resuming}
              className="shrink-0 ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[color:var(--accent)]/10 text-[color:var(--accent)] border border-[color:var(--accent)]/30 hover:bg-[color:var(--accent)]/20 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={10} className={resuming ? 'animate-spin' : ''} />
              {resuming ? 'Dispatching…' : 'Resume'}
            </button>
          )}
          <span className="ml-auto shrink-0 text-fg-5">{items.length} events</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {isStalled && (
            <li className="rounded-md border border-dashed border-yellow-500/30 bg-yellow-500/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-yellow-400">
              <span className="font-mono uppercase tracking-wider">
                Agent may have stalled — no events for{' '}
                {lastMs != null ? formatDuration(now - lastMs) : '?'}
              </span>
            </li>
          )}
          {isLive && !isStalled && (
            <li className="rounded-md border border-dashed border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-[color:var(--accent)]">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span className="font-mono uppercase tracking-wider">Agent running…</span>
            </li>
          )}
          {codexTransportWarning != null && (
            <li
              className={
                isFailed && !warningRecovered
                  ? 'rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-[color:var(--danger)]'
                  : 'rounded-md border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-yellow-400'
              }
              title={getAgentLogDisplayText(codexTransportWarning)}
            >
              <AlertTriangle size={12} className="shrink-0" />
              <span className="font-mono uppercase tracking-wider">
                {warningRecovered
                  ? 'Codex transport warning: websocket 503; run recovered'
                  : isFailed
                    ? 'Codex transport warning: websocket 503; run failed after warning'
                    : 'Codex transport warning: websocket 503; run still active'}
              </span>
            </li>
          )}
          {sorted.map((item, i) => renderItem(item, idx * 1000 + i, context))}
        </ol>
      </details>
    </li>
  );
}

function aggregateRunGroupCosts(
  runId: string,
  events: Array<{ runId?: string | null }>,
  runCosts: Map<string, CostRowDto> | undefined,
): Pick<
  CostRowDto,
  | 'inputTokens'
  | 'cachedInputTokens'
  | 'outputTokens'
  | 'reasoningOutputTokens'
  | 'costUsd'
  | 'costLabel'
  | 'cacheHitRatio'
  | 'modelId'
  | 'provider'
> | null {
  if (runCosts == null) return null;
  const runIds = new Set<string>([runId]);
  for (const event of events) {
    if (event.runId != null && event.runId.trim() !== '') runIds.add(event.runId);
  }

  const rows = [...runIds].map((id) => runCosts.get(id)).filter((row) => row != null);
  if (rows.length === 0) return null;

  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  let costUsd = 0;
  let costLabel: CostLabel = 'exact';
  for (const row of rows) {
    inputTokens += row.inputTokens;
    cachedInputTokens += row.cachedInputTokens;
    outputTokens += row.outputTokens;
    reasoningOutputTokens += row.reasoningOutputTokens;
    costUsd += row.costUsd;
    if (row.costLabel === 'estimated') costLabel = 'estimated';
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    costUsd,
    costLabel,
    cacheHitRatio: cachedInputTokens / Math.max(inputTokens, 1),
    modelId: rows[0].modelId,
    provider: rows[0].provider,
  };
}
