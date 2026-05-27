import { ProjectBudgetBanner } from '@/components/ui/ProjectBudgetBanner';
import { fetchEventsPage, fetchIssue, fetchIssues } from '@/lib/api';
import { LANES, laneForState, sortLaneItems } from '@/lib/lanes.config';
import { useProjectBudgetStatus } from '@/lib/project-budget';
import type { AgentEventDto } from '@/lib/types';
import { useActiveMilestone } from '@/state/active-milestone';
import { ISSUE_TIMELINE_EVENT_KINDS } from '@goose-hub/core/event-stream/issue-timeline.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  applyIssueTimelineEvent,
  applyLatestEventState,
  backfillIssueTimelineEvents,
  mergeIssueEvents,
  patchIssueStateFromLatestTransition,
} from '../lib/live-events';
import { SECTIONS } from '../lib/sections';
import { computeIsLive } from '../lib/timeline';
import { useHasOpenDep } from '../lib/useHasOpenDep';
import { ApprovalGateSection } from './ApprovalGateSection';
import { CodeDiffSection } from './CodeDiffSection';
import { CostsSection } from './CostsSection';
import { DeferredSurface } from './DeferredSurface';
import { GatePendingBanner } from './GatePendingBanner';
import { GrillSection } from './GrillSection';
import { InvestigationSection } from './InvestigationSection';
import { LeftRail } from './LeftRail';
import { OverviewSection } from './OverviewSection';
import { PRDSection } from './PRDSection';
import { PendingNextRunBanner } from './PendingNextRunBanner';
import { QASection } from './QASection';
import { RetrospectiveSection } from './RetrospectiveSection';
import { ReviewSection } from './ReviewSection';
import { TaskHeader } from './TaskHeader';
import { TimelineSection } from './TimelineSection';
import { TriageResultsSection } from './TriageResultsSection';

const TIMELINE_PAGE_SIZE = 200;

interface DetailPageProps {
  section?: string;
}

export function DetailPage({ section = 'overview' }: DetailPageProps) {
  const { slug = 'goose-hub-self', id = '' } = useParams<{ slug: string; id: string }>();
  const navigate = useNavigate();
  const { activeNumber } = useActiveMilestone();

  const queryClient = useQueryClient();

  const {
    data: item,
    // isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['issue', slug, id],
    queryFn: async () =>
      applyLatestEventState(
        await fetchIssue(slug, id),
        queryClient.getQueryData<AgentEventDto[]>(['events', slug, id]),
      ),
    enabled: id.length > 0,
  });

  const eventsQuery = useQuery({
    queryKey: ['events', slug, id],
    queryFn: async ({ signal }) => {
      const { events } = await fetchEventsPage(slug, id, { limit: TIMELINE_PAGE_SIZE }, signal);
      const merged = mergeIssueEvents(
        queryClient.getQueryData<AgentEventDto[]>(['events', slug, id]),
        events,
      );
      patchIssueStateFromLatestTransition(queryClient, slug, id, merged);
      return merged;
    },
    enabled: id.length > 0,
  });

  // Reuse the board's cached issues list for sibling navigation — no extra fetch.
  const { data: allIssues = [] } = useQuery({
    queryKey: ['issues', slug],
    queryFn: async () => {
      const issues = await fetchIssues(slug);
      const issueEvents = queryClient.getQueryData<AgentEventDto[]>(['events', slug, id]);
      return issues.map((issue) =>
        issue.externalId === id ? applyLatestEventState(issue, issueEvents) : issue,
      );
    },
  });

  const siblings = useMemo(() => {
    const filtered =
      activeNumber != null
        ? allIssues.filter((it) => it.milestoneId === String(activeNumber))
        : allIssues;
    const ordered: string[] = [];
    for (const lane of LANES) {
      const inLane = filtered.filter((it) => laneForState(it.state) === lane.key);
      for (const it of sortLaneItems(inLane)) ordered.push(it.externalId);
    }
    return ordered;
  }, [allIssues, activeNumber]);

  const onBack = useCallback(() => {
    navigate(`/projects/${slug}`);
  }, [navigate, slug]);

  const onPrev = useCallback(() => {
    if (siblings.length === 0) return;
    const idx = siblings.indexOf(id);
    if (idx <= 0) return;
    navigate(`/projects/${slug}/items/${siblings[idx - 1]}`);
  }, [navigate, siblings, id, slug]);

  const onNext = useCallback(() => {
    if (siblings.length === 0) return;
    const idx = siblings.indexOf(id);
    if (idx === -1 || idx >= siblings.length - 1) return;
    navigate(`/projects/${slug}/items/${siblings[idx + 1]}`);
  }, [navigate, siblings, id, slug]);

  // Keyboard: J / K / ⌘[ / Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if ((e.target as HTMLElement | null)?.tagName === 'TEXTAREA') return;
      if (e.key === 'j') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'k') {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      } else if (e.key === '[' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onNext, onPrev]);

  const hasOpenDep = useHasOpenDep(item, slug);
  const { data: budgetStatus } = useProjectBudgetStatus(slug);

  const currentSection = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const workItemId = item?.canonicalWorkItemId ?? item?.id ?? '';

  const safetyRefetchTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const backfillMissedEvents = useCallback(
    () =>
      backfillIssueTimelineEvents({
        queryClient,
        projectSlug: slug,
        issueId: id,
        fetchPage: fetchEventsPage,
        limit: TIMELINE_PAGE_SIZE,
      }),
    [queryClient, slug, id],
  );

  useEffect(() => {
    if (!computeIsLive(eventsQuery.data ?? [])) return;
    safetyRefetchTimer.current = setInterval(() => {
      void eventsQuery.refetch();
    }, 30_000);
    return () => {
      if (safetyRefetchTimer.current != null) clearInterval(safetyRefetchTimer.current);
      safetyRefetchTimer.current = null;
    };
  }, [eventsQuery.data, eventsQuery.refetch]);

  // DetailPage owns the issue-level SSE stream. Child sections consume the
  // shared ['events', slug, id] cache and their own query invalidations.
  useEffect(() => {
    if (!workItemId || !eventsQuery.isSuccess) return;
    const cached = queryClient.getQueryData<AgentEventDto[]>(['events', slug, id]) ?? [];
    const lastEventId = cached[0]?.id ?? 0;
    const params = new URLSearchParams({
      projectId: slug,
      workItemId,
      lastEventId: String(lastEventId),
    });
    const es = new EventSource(`/events?${params}`);
    let hadConnectionError = false;

    const handleEvent = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as AgentEventDto;
        applyIssueTimelineEvent(queryClient, slug, id, parsed);
      } catch {
        // Ignore malformed SSE payloads; the next backfill/refetch recovers.
      }
    };

    for (const kind of ISSUE_TIMELINE_EVENT_KINDS) {
      es.addEventListener(kind, handleEvent as EventListener);
    }
    es.onmessage = handleEvent;
    es.onopen = () => {
      if (!hadConnectionError) return;
      hadConnectionError = false;
      void backfillMissedEvents();
    };
    es.onerror = () => {
      hadConnectionError = true;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void backfillMissedEvents();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      for (const kind of ISSUE_TIMELINE_EVENT_KINDS) {
        es.removeEventListener(kind, handleEvent as EventListener);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      es.close();
    };
  }, [slug, id, workItemId, eventsQuery.isSuccess, queryClient, backfillMissedEvents]);

  if (isError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-[color:var(--danger)] text-sm">Couldn't load this issue.</div>
        <pre className="font-mono text-[11.5px] text-fg-3 max-w-2xl whitespace-pre-wrap">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <button
          type="button"
          onClick={onBack}
          className="h-7 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
        >
          Back to Board
        </button>
      </div>
    );
  }

  return (
    <div className="h-full">
      <div className="h-full flex flex-col" data-testid="detail-page">
        <div className="h-[40px] flex items-center gap-3 px-3 border-b border-line bg-bg-glass shrink-0">
          <button
            type="button"
            onClick={onBack}
            data-testid="back-to-board"
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover"
          >
            <ArrowLeft size={13} />
            Board
          </button>
          <span aria-hidden className="w-[1px] h-4 bg-line" />
          <span className="font-mono text-[12px] text-fg-3 truncate">
            <span className="text-fg-3">{slug}</span>
            <span className="mx-1.5 text-fg-2">/</span>
            <span className="text-fg-3">{item?.repoRef}</span>
            <span className="mx-1.5 text-fg-2">/</span>
            <span className="text-fg font-semibold">#{item?.externalId}</span>
          </span>
          <span className="grow" />
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous issue (K)"
            title="Previous issue (K)"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next issue (J)"
            title="Next issue (J)"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            onClick={onBack}
            aria-label="Close (⌘[ )"
            title="Close (⌘[)"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
          >
            <X size={13} />
          </button>
        </div>

        <TaskHeader item={item} projectSlug={slug} hasOpenDep={hasOpenDep} />
        <ProjectBudgetBanner status={budgetStatus} />

        <GatePendingBanner
          state={item?.state}
          projectSlug={slug}
          id={id}
          onTransitioned={() => {
            void queryClient.invalidateQueries({ queryKey: ['issue', slug, id] });
            void queryClient.invalidateQueries({ queryKey: ['issues', slug] });
          }}
        />
        <PendingNextRunBanner state={item?.state} projectSlug={slug} id={id} />

        <ApprovalGateSection projectSlug={slug} id={id} state={item?.state} />

        <div className="flex-1 min-h-0 flex">
          <LeftRail prdParent={item?.prdParent} itemType={item?.type} />
          <main className="flex-1 min-w-0 overflow-y-auto">
            {currentSection.key === 'overview' ? (
              <OverviewSection item={item} projectSlug={slug} />
            ) : currentSection.key === 'repo' ? (
              <TriageResultsSection projectSlug={slug} id={id} />
            ) : currentSection.key === 'timeline' ? (
              <TimelineSection projectSlug={slug} id={id} />
            ) : currentSection.key === 'investigation' ? (
              <InvestigationSection
                projectSlug={slug}
                id={id}
                itemState={item?.state}
                itemType={item?.type}
              />
            ) : currentSection.key === 'prd' ? (
              <PRDSection projectSlug={slug} id={id} state={item?.state} />
            ) : currentSection.key === 'grill' ? (
              <GrillSection
                projectSlug={slug}
                externalId={item?.externalId ?? id}
                id={id}
                state={item?.state}
              />
            ) : currentSection.key === 'code' ? (
              <CodeDiffSection projectSlug={slug} id={id} />
            ) : currentSection.key === 'qa' ? (
              <QASection projectSlug={slug} id={id} />
            ) : currentSection.key === 'review' ? (
              <ReviewSection projectSlug={slug} id={id} />
            ) : currentSection.key === 'retrospective' ? (
              <RetrospectiveSection projectSlug={slug} id={id} />
            ) : currentSection.key === 'costs' ? (
              <CostsSection projectSlug={slug} id={id} />
            ) : (
              <DeferredSurface
                surface={currentSection.label}
                milestone={currentSection.milestone ?? 'later'}
                description={currentSection.description}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
