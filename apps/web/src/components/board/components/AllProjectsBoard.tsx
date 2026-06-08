import { fetchIssues, fetchProjectConfigs } from '@/lib/api';
import { LANES } from '@/lib/lanes.config';
import { logger } from '@/lib/logger';
import type { WorkItemDto } from '@/lib/types';
import { useLaneVisibility } from '@/state/lane-visibility';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Eye, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { groupAllProjectsItems } from '../lib/all-projects';
import { IssueCard } from './IssueCard';

const RECOVERY_REFETCH_INTERVAL_MS = 30_000;

export function AllProjectsBoard() {
  const queryClient = useQueryClient();
  const { hidden, toggle, reset } = useLaneVisibility();

  const configsQuery = useQueries({
    queries: [
      {
        queryKey: ['project-configs'],
        queryFn: () => fetchProjectConfigs(),
      },
    ],
  })[0];

  const configs = configsQuery.data ?? [];
  const projectSlugs = useMemo(() => configs.map((cfg) => cfg.slug), [configs]);

  const issueQueries = useQueries({
    queries: configs.map((cfg) => ({
      queryKey: ['issues-all', cfg.slug],
      queryFn: () => fetchIssues(cfg.slug, { all: true }),
      enabled: configs.length > 0,
      refetchInterval: RECOVERY_REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    })),
  });

  const isLoading = configsQuery.isLoading || issueQueries.some((q) => q.isLoading);
  const isError = configsQuery.isError || issueQueries.some((q) => q.isError);

  const refetchAllProjectIssues = useCallback(() => {
    for (const slug of projectSlugs) {
      void queryClient.invalidateQueries({ queryKey: ['issues-all', slug] });
    }
  }, [projectSlugs, queryClient]);

  // SSE: listen for state transitions across all projects (no projectId filter).
  useEffect(() => {
    if (projectSlugs.length === 0) return;
    const configuredProjects = new Set(projectSlugs);
    const es = new EventSource('/events');
    let hadConnectionError = false;

    const onTransition = (msg: MessageEvent<string>) => {
      try {
        const event = JSON.parse(msg.data) as {
          projectId?: string;
          workItemId: string | null;
          payload: { from?: string; to?: string };
        };
        if (
          event.projectId == null ||
          !configuredProjects.has(event.projectId) ||
          event.workItemId == null ||
          event.payload?.to == null
        ) {
          return;
        }
        const externalId = event.workItemId.split('#').pop();
        if (externalId == null) return;
        const patchState = (prev?: WorkItemDto[]) =>
          prev?.map((it) =>
            it.externalId === externalId ? { ...it, state: event.payload.to as string } : it,
          ) ?? prev;
        queryClient.setQueryData<WorkItemDto[]>(['issues-all', event.projectId], patchState);
        queryClient.setQueryData<WorkItemDto[]>(['issues', event.projectId], patchState);
      } catch (err) {
        logger.warn('AllProjectsBoard: failed to parse SSE event', { err: String(err) });
      }
    };
    es.addEventListener('state.transitioned', onTransition as EventListener);

    es.onopen = () => {
      if (!hadConnectionError) return;
      hadConnectionError = false;
      refetchAllProjectIssues();
    };
    es.onerror = () => {
      hadConnectionError = true;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refetchAllProjectIssues();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      es.removeEventListener('state.transitioned', onTransition as EventListener);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      es.close();
    };
  }, [projectSlugs, queryClient, refetchAllProjectIssues]);

  const enrichedItems = useMemo(() => {
    return configs.flatMap((cfg, i) => {
      const items = issueQueries[i]?.data ?? [];
      return items.map((item) => ({
        ...item,
        projectSlug: cfg.slug,
        projectColor: cfg.colorStripe,
      }));
    });
  }, [configs, issueQueries]);

  const itemsByLane = useMemo(() => groupAllProjectsItems(enrichedItems, LANES), [enrichedItems]);

  const totalItems = enrichedItems.length;
  const visibleLanes = useMemo(() => LANES.filter((l) => !hidden.has(l.key)), [hidden]);
  const hiddenLanes = useMemo(() => LANES.filter((l) => hidden.has(l.key)), [hidden]);

  if (isError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-[color:var(--danger)] text-sm">Couldn't load issues.</div>
        <button
          type="button"
          onClick={() => {
            void configsQuery.refetch();
            for (const q of issueQueries) void q.refetch();
          }}
          className="h-7 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
        >
          <RefreshCw size={12} className="inline mr-1" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="board">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-line shrink-0 text-[12px] text-fg-3">
        <span data-testid="board-issue-count">
          {isLoading ? '…' : `${totalItems} issue${totalItems === 1 ? '' : 's'}`}
        </span>
        <span className="text-fg-2">
          across {configs.length} project{configs.length === 1 ? '' : 's'}
        </span>
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
        {visibleLanes.map((lane) => {
          const laneItems = itemsByLane.get(lane.key) ?? [];
          return (
            <div
              key={lane.key}
              data-testid={`lane-${lane.key}`}
              className="flex-1 min-w-[260px] max-w-[320px] flex flex-col rounded-lg border border-line bg-bg/60"
            >
              <div className="flex items-center gap-2 px-3.5 py-3 border-b border-line shrink-0">
                <span className="text-[12.5px] font-semibold tracking-tight">{lane.label}</span>
                <span className="font-mono tnum text-[11px] text-fg-3">{laneItems.length}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2">
                {laneItems.length === 0 ? (
                  <div className="text-[11.5px] text-fg-2 px-2 py-4 text-center italic">empty</div>
                ) : (
                  laneItems.map((item) => (
                    <IssueCard
                      key={item.id}
                      item={item}
                      projectSlug={item.projectSlug}
                      projectColor={item.projectColor}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
