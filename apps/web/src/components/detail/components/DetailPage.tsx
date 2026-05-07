import { fetchIssue, fetchIssues, startFakeRun } from '@/lib/api';
import { LANES, laneForState, sortLaneItems } from '@/lib/lanes.config';
import type { WorkItemDto } from '@/lib/types';
import { useActiveMilestone } from '@/state/active-milestone';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SECTIONS } from '../lib/sections';
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
import { QASection } from './QASection';
import { RetrospectiveSection } from './RetrospectiveSection';
import { ReviewSection } from './ReviewSection';
import { RightRail } from './RightRail';
import { TaskHeader } from './TaskHeader';
import { TimelineSection } from './TimelineSection';
import { TriageResultsSection } from './TriageResultsSection';

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
    queryFn: () => fetchIssue(slug, id),
    enabled: id.length > 0,
  });

  // Reuse the board's cached issues list for sibling navigation — no extra fetch.
  const { data: allIssues = [] } = useQuery({
    queryKey: ['issues', slug],
    queryFn: () => fetchIssues(slug),
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

  const [fakeRunInProgress, setFakeRunInProgress] = useState(false);
  const hasOpenDep = useHasOpenDep(item, slug);

  const onFakeRun = useCallback(() => {
    if (fakeRunInProgress) return;
    setFakeRunInProgress(true);
    startFakeRun(slug, id, 'triage').finally(() => {
      setTimeout(() => setFakeRunInProgress(false), 4000);
    });
  }, [fakeRunInProgress, slug, id]);

  const currentSection = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const workItemId = item != null ? `github:${item.repoRef}#${item.externalId}` : '';

  // Re-fetch the issue when an agent transitions its state (e.g. after triage).
  useEffect(() => {
    if (!workItemId) return;
    const url = `/events?projectId=${encodeURIComponent(slug)}&workItemId=${encodeURIComponent(workItemId)}`;
    const es = new EventSource(url);
    const onTransitioned = () => {
      void queryClient.invalidateQueries({ queryKey: ['issue', slug, id] });
      void queryClient.invalidateQueries({ queryKey: ['issues', slug] });
    };
    es.addEventListener('state.transitioned', onTransitioned);
    es.addEventListener('gate.rejected', onTransitioned);
    return () => es.close();
  }, [slug, id, workItemId, queryClient]);

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
            onClick={onFakeRun}
            disabled={fakeRunInProgress}
            data-testid="fake-run-btn"
            className="h-7 px-2.5 rounded-md border border-line text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fakeRunInProgress ? 'Running...' : 'Start fake triage'}
          </button>
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

        <GatePendingBanner
          state={item?.state}
          projectSlug={slug}
          id={id}
          onTransitioned={() => {
            void queryClient.invalidateQueries({ queryKey: ['issue', slug, id] });
            void queryClient.invalidateQueries({ queryKey: ['issues', slug] });
          }}
        />

        <ApprovalGateSection projectSlug={slug} id={id} state={item?.state} />

        <div className="flex-1 min-h-0 flex">
          <LeftRail itemState={item?.state} />
          <main className="flex-1 min-w-0 overflow-y-auto">
            {currentSection.key === 'overview' ? (
              <OverviewSection item={item} projectSlug={slug} />
            ) : currentSection.key === 'repo' ? (
              <TriageResultsSection projectSlug={slug} id={id} />
            ) : currentSection.key === 'timeline' ? (
              <TimelineSection projectSlug={slug} id={id} workItemId={workItemId} />
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
          {/* projectSlug={slug} id={id} workItemId={workItemId} */}
          {/* <RightRail /> */}
        </div>
      </div>
    </div>
  );
}
