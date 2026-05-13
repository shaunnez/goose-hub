// The Office tab content: loads the project list + active issues across all
// projects, subscribes to the SSE event stream, derives agent placements, and
// renders the Phaser scene + the floor indicator + the click-through detail
// panel.
//
// Designed to be embedded in `OfficePage` (which adds the AppShell chrome) or
// in tests in isolation.

import { fetchIssues, fetchProjects } from '@/lib/api';
import type { WorkItemDto } from '@/lib/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeskClickPayload, FloorChangePayload, OfficeProject } from '../game/OfficeScene';
import { placementsFromItems } from '../lib/agent-positions';
import type { OrchestrationEvent, Timeline } from '../lib/choreography';
import { LANE_FOR_EVENT, timelinesForEvent } from '../lib/choreography';
import { ROOM_IDS } from '../lib/rooms';
import { DeskDetailPanel } from './DeskDetailPanel';
import { FloorIndicator } from './FloorIndicator';

// Lazy-load the Phaser-backed mount so Phaser (~1MB) ships in its own chunk
// instead of bloating the initial bundle that every other tab pays for.
const OfficeGameMount = lazy(() =>
  import('./OfficeGameMount').then((m) => ({ default: m.OfficeGameMount })),
);

interface OfficeTabProps {
  /** Project to focus the camera on initially. */
  initialProjectSlug?: string;
}

export function OfficeTab({ initialProjectSlug }: OfficeTabProps) {
  const queryClient = useQueryClient();
  const [activeSlug, setActiveSlug] = useState<string | null>(initialProjectSlug ?? null);
  const [floorIndex, setFloorIndex] = useState(0);
  const [deskPayload, setDeskPayload] = useState<DeskClickPayload | null>(null);

  // Hero ticket ID is tracked in a ref (not state) so SSE handlers read the
  // latest value without needing to be re-registered on every change.
  const heroTicketIdRef = useRef<string | null>(null);
  // Choreography bridge: set by OfficeGameMount once the scene is ready.
  const choreographyRef = useRef<((timelines: Timeline[]) => void) | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['office-projects'],
    queryFn: () => fetchProjects(),
    staleTime: 60_000,
  });

  // Fetch issues per project in parallel. We need the active state per
  // work item so the scene can derive desk + indicator.
  const { data: itemsByProject = {} } = useQuery({
    queryKey: ['office-issues', projects.map((p) => p.slug).join(',')],
    enabled: projects.length > 0,
    queryFn: async () => {
      const map: Record<string, WorkItemDto[]> = {};
      await Promise.all(
        projects.map(async (p) => {
          try {
            map[p.slug] = await fetchIssues(p.slug);
          } catch {
            map[p.slug] = [];
          }
        }),
      );
      return map;
    },
    staleTime: 30_000,
  });

  // Map ProjectSummary → OfficeProject (scene's view of a project).
  const officeProjects = useMemo<OfficeProject[]>(
    () =>
      projects.map((p) => ({
        slug: p.slug,
        name: p.name,
        color: p.color,
      })),
    [projects],
  );

  // Derive flat list of agent placements (one per active work item per project).
  const placements = useMemo(() => {
    const flat = projects.flatMap((p) => {
      const items = itemsByProject[p.slug] ?? [];
      return items.map((it) => ({
        workItemId: it.id,
        externalId: it.externalId,
        projectSlug: p.slug,
        state: it.state,
        title: it.title,
      }));
    });
    return placementsFromItems(flat);
  }, [projects, itemsByProject]);

  // SSE: dual path — React Query invalidation (placements re-derive) + choreography.
  // Subscribes to all event kinds listed in LANE_FOR_EVENT.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/events');

    const handlers = new Map<string, (e: MessageEvent) => void>();
    for (const kind of Object.keys(LANE_FOR_EVENT) as Array<keyof typeof LANE_FOR_EVENT>) {
      const handler = (e: MessageEvent) => {
        // Invalidate issues on state transitions so placements re-derive.
        if (kind === 'state.transitioned') {
          void queryClient.invalidateQueries({ queryKey: ['office-issues'] });
        }
        // Build timelines from event and dispatch into the Phaser scene.
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(e.data as string) as Record<string, unknown>;
        } catch {
          // malformed SSE data — treat as empty payload
        }
        const event: OrchestrationEvent = { kind, ...parsed };
        const timelines = timelinesForEvent(event, {
          hero: heroTicketIdRef.current,
          rooms: ROOM_IDS,
        });
        if (timelines.length > 0) choreographyRef.current?.(timelines);
      };
      handlers.set(kind, handler);
      es.addEventListener(kind, handler);
    }

    return () => {
      for (const [kind, handler] of handlers) {
        es.removeEventListener(kind, handler);
      }
      es.close();
    };
  }, [queryClient]);

  // Choose an active slug if none provided.
  useEffect(() => {
    if (activeSlug == null && projects.length > 0) setActiveSlug(projects[0].slug);
  }, [activeSlug, projects]);

  const handleDeskClick = useCallback((payload: DeskClickPayload) => {
    setDeskPayload(payload);
  }, []);

  const handleHeroChanged = useCallback((ticketId: string | null) => {
    heroTicketIdRef.current = ticketId;
  }, []);

  const handleFloorChange = useCallback((payload: FloorChangePayload) => {
    setFloorIndex(payload.floorIndex);
    setActiveSlug(payload.projectSlug);
  }, []);

  // Floor up/down via the indicator buttons. We poke the scene by changing
  // `activeProjectSlug` — that triggers `panToProject` which fires `floor-change`.
  const upDown = useCallback(
    (delta: number) => {
      const next = floorIndex + delta;
      if (next < 0 || next >= projects.length) return;
      setActiveSlug(projects[next].slug);
    },
    [floorIndex, projects],
  );

  const activeProject = projects[floorIndex] ?? projects[0];

  return (
    <div className="relative h-full w-full" data-testid="office-tab">
      <Suspense
        fallback={
          <div
            data-testid="office-canvas-loading"
            className="absolute inset-0 flex items-center justify-center text-fg-2 text-[12px] bg-[#0d0a13]"
          >
            Loading office…
          </div>
        }
      >
        <OfficeGameMount
          projects={officeProjects}
          placements={placements}
          activeProjectSlug={activeSlug}
          onDeskClick={handleDeskClick}
          onFloorChange={handleFloorChange}
          choreographyRef={choreographyRef}
          onHeroChanged={handleHeroChanged}
        />
      </Suspense>
      {projects.length > 0 && activeProject && (
        <FloorIndicator
          floorIndex={floorIndex}
          totalFloors={projects.length}
          projectName={activeProject.name}
          onUp={() => upDown(-1)}
          onDown={() => upDown(+1)}
        />
      )}
      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-fg-2 text-[12px]">
          No projects registered. Bootstrap one to populate the office.
        </div>
      )}
      <DeskDetailPanel payload={deskPayload} onClose={() => setDeskPayload(null)} />
    </div>
  );
}
