import { type WorkItemDto, fetchIssues } from '@/lib/api';
import { LANES, laneForState, sortLaneItems } from '@/lib/lanes.config';
import { useActiveMilestone } from '@/state/active-milestone';
import { useLaneVisibility } from '@/state/lane-visibility';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from 'boneyard-js/react';
import { Eye, RefreshCw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { BoardColumn } from './BoardColumn';

interface BoardProps {
  projectSlug: string;
}

export function Board({ projectSlug }: BoardProps) {
  const queryClient = useQueryClient();
  const { hidden, toggle, reset } = useLaneVisibility();
  const { activeNumber: resolvedMilestone } = useActiveMilestone();

  const {
    data: items = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['issues', projectSlug],
    queryFn: () => fetchIssues(projectSlug),
  });

  // SSE: patch board state in-place on transition events.
  useEffect(() => {
    const url = `/events?projectId=${encodeURIComponent(projectSlug)}`;
    const es = new EventSource(url);
    const onTransition = (msg: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(msg.data) as {
          workItemId: string | null;
          payload: { from?: string; to?: string };
        };
        if (payload.workItemId == null || payload.payload?.to == null) return;
        const externalId = payload.workItemId.split('#').pop();
        if (externalId == null) return;
        queryClient.setQueryData<WorkItemDto[]>(['issues', projectSlug], (prev) =>
          prev?.map((it) =>
            it.externalId === externalId
              ? { ...it, state: payload.payload.to as string }
              : it,
          ) ?? prev,
        );
      } catch {
        // ignore malformed events
      }
    };
    es.addEventListener('state.transitioned', onTransition as EventListener);
    return () => {
      es.removeEventListener('state.transitioned', onTransition as EventListener);
      es.close();
    };
  }, [projectSlug, queryClient]);

  const filtered = useMemo(() => {
    if (resolvedMilestone == null) return items;
    return items.filter((item) => item.milestoneId === String(resolvedMilestone));
  }, [items, resolvedMilestone]);

  const itemsByLane = useMemo(() => {
    const out = new Map<string, WorkItemDto[]>();
    for (const lane of LANES) out.set(lane.key, []);
    for (const item of filtered) {
      const laneKey = laneForState(item.state);
      if (laneKey == null) continue;
      out.get(laneKey)?.push(item);
    }
    for (const key of out.keys()) {
      const arr = out.get(key);
      if (arr != null) out.set(key, sortLaneItems(arr));
    }
    return out;
  }, [filtered]);

  const visibleLanes = useMemo(() => LANES.filter((l) => !hidden.has(l.key)), [hidden]);
  const hiddenLanes = useMemo(() => LANES.filter((l) => hidden.has(l.key)), [hidden]);

  if (isError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-[color:var(--danger)] text-sm">Couldn't load issues.</div>
        <pre className="font-mono text-[11.5px] text-fg-3 max-w-2xl whitespace-pre-wrap">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <button
          type="button"
          onClick={() => void refetch()}
          className="h-7 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
        >
          <RefreshCw size={12} className="inline mr-1" /> Retry
        </button>
      </div>
    );
  }

  return (
    <Skeleton name="board" loading={isLoading} animate="shimmer" color="var(--bg-elev)">
      <div className="h-full flex flex-col" data-testid="board">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-line shrink-0 text-[12px] text-fg-3">
          <span data-testid="board-issue-count">
            {filtered.length} issue{filtered.length === 1 ? '' : 's'}
          </span>
          {resolvedMilestone != null && (
            <span>
              · milestone <span className="font-mono tnum">#{resolvedMilestone}</span>
            </span>
          )}
          <span className="grow" />
          {hiddenLanes.length > 0 && (
            <details className="relative">
              <summary className="cursor-pointer list-none flex items-center gap-1.5 hover:text-fg">
                <Eye size={12} /> Hidden lanes ({hiddenLanes.length})
              </summary>
              <div className="absolute right-0 mt-1 z-10 min-w-[180px] rounded-md border border-line bg-bg-elev shadow-md p-1.5 flex flex-col gap-0.5">
                {hiddenLanes.map((lane) => (
                  <button
                    key={lane.key}
                    type="button"
                    onClick={() => toggle(lane.key)}
                    className="text-left px-2 py-1 text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover rounded"
                  >
                    Show {lane.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={reset}
                  className="text-left px-2 py-1 text-[11px] text-fg-3 hover:text-fg hover:bg-bg-hover rounded mt-1 border-t border-line"
                >
                  Reset to defaults
                </button>
              </div>
            </details>
          )}
        </div>
        <div className="flex-1 min-h-0 px-3 py-3 flex gap-3 overflow-x-auto">
          {visibleLanes.map((lane) => (
            <BoardColumn
              key={lane.key}
              lane={lane}
              items={itemsByLane.get(lane.key) ?? []}
              projectSlug={projectSlug}
              onHide={toggle}
            />
          ))}
        </div>
      </div>
    </Skeleton>
  );
}
