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
import type Phaser from 'phaser';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeskClickPayload, FloorChangePayload, OfficeProject } from '../game/OfficeScene';
import { placementsFromItems } from '../lib/agent-positions';
import type { OrchestrationEvent, Timeline } from '../lib/choreography';
import { LANE_FOR_EVENT, timelinesForEvent } from '../lib/choreography';
import type { RoomId } from '../lib/rooms';
import { ROOM_IDS } from '../lib/rooms';
import { BottomHudBar, type TeamCounts } from './BottomHudBar';
import { DeskDetailPanel } from './DeskDetailPanel';
import { EventFeedSidebar } from './EventFeedSidebar';
import { FloorIndicator } from './FloorIndicator';
import { QueuePanel, useQueueClickSubscription } from './QueuePanel';
import type { QueueClickPayload } from './QueuePanel';
import { TopHudBar } from './TopHudBar';

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
  const [queueRoom, setQueueRoom] = useState<RoomId | null>(null);
  const [sceneEmitter, setSceneEmitter] = useState<Phaser.Events.EventEmitter | null>(null);

  // Hero ticket ID is tracked in a ref (not state) so SSE handlers read the
  // latest value without needing to be re-registered on every change.
  const heroTicketIdRef = useRef<string | null>(null);
  // floorIndex ref mirrors the state value so SSE handlers see the latest floor
  // without needing to be re-registered on every floor change.
  const floorIndexRef = useRef(0);
  // Choreography bridge: set by OfficeGameMount once the scene is ready.
  const choreographyRef = useRef<((timelines: Timeline[]) => void) | null>(null);
  // Reverse lookup: internal workItemId (UUID) → office scene { projectSlug, externalId }.
  // Allows SSE AgentEvent.workItemId to be mapped to the ${projectSlug}:${externalId}
  // format used by PersonaLayer and TicketLayer as entity keys.
  const workItemLookupRef = useRef<Map<string, { projectSlug: string; externalId: string }>>(
    new Map(),
  );

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

  // Keep workItemLookupRef current whenever the issue cache refreshes.
  useEffect(() => {
    const map = new Map<string, { projectSlug: string; externalId: string }>();
    for (const [projectSlug, items] of Object.entries(itemsByProject)) {
      for (const item of items) {
        map.set(item.id, { projectSlug, externalId: item.externalId });
      }
    }
    workItemLookupRef.current = map;
  }, [itemsByProject]);

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
        // Normalize SSE AgentEvent → OrchestrationEvent.
        // AgentEvent has: { workItemId (UUID), personaId (roster format), payload: {...} }.
        // Office scene uses ${projectSlug}:${externalId} as entity keys.
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(e.data as string) as Record<string, unknown>;
        } catch {
          // malformed SSE data — treat as empty payload
        }
        const workItemId = typeof parsed.workItemId === 'string' ? parsed.workItemId : null;
        const entry = workItemId ? workItemLookupRef.current.get(workItemId) : undefined;
        const officeId = entry ? `${entry.projectSlug}:${entry.externalId}` : undefined;
        // state.transitioned wraps { from, to, by } in payload; extract toState from payload.to.
        const innerPayload =
          typeof parsed.payload === 'object' && parsed.payload !== null
            ? (parsed.payload as Record<string, unknown>)
            : {};
        const event: OrchestrationEvent = {
          kind,
          ticketId: officeId,
          personaId: officeId,
          toState: typeof innerPayload.to === 'string' ? innerPayload.to : undefined,
          projectSlug: entry?.projectSlug,
        };
        const timelines = timelinesForEvent(event, {
          hero: heroTicketIdRef.current,
          rooms: ROOM_IDS,
          floorIndex: floorIndexRef.current,
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

  const handleQueueClick = useCallback((payload: QueueClickPayload) => {
    setQueueRoom(payload.roomId);
  }, []);

  // Wire queue-click events from the scene emitter
  useQueueClickSubscription(sceneEmitter, handleQueueClick);

  // Derive queued items for the open queue room
  const queueItems = useMemo(() => {
    if (queueRoom == null) return [];
    const allTickets = placements.tickets;
    return allTickets
      .filter((t) => t.position === 'queue' && t.roomId === queueRoom)
      .map((t) => ({
        ticketId: t.ticketId,
        externalId: t.externalId,
        title: t.title,
        priority: t.priority,
      }));
  }, [queueRoom, placements.tickets]);

  const handleHeroChanged = useCallback((ticketId: string | null) => {
    heroTicketIdRef.current = ticketId;
  }, []);

  const handleFloorChange = useCallback((payload: FloorChangePayload) => {
    setFloorIndex(payload.floorIndex);
    floorIndexRef.current = payload.floorIndex;
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

  // Phase 4 HUD derivations — team counters by role bucket. Mapping from
  // roomId → role bucket is intentionally loose (placeholder); a future
  // phase will use stateToRole for exact role attribution.
  const team = useMemo<TeamCounts>(() => {
    const t: TeamCounts = { scout: 0, dev: 0, qa: 0, reviewer: 0, ops: 0 };
    for (const p of placements.personas) {
      switch (p.roomId) {
        case 'investigation':
        case 'library':
          t.scout++;
          break;
        case 'dev':
        case 'triage':
        case 'backlog':
          t.dev++;
          break;
        case 'qa':
          t.qa++;
          break;
        case 'review':
        case 'retro':
          t.reviewer++;
          break;
        default:
          t.ops++;
      }
    }
    return t;
  }, [placements.personas]);

  // Total in-flight tickets for the top-bar counter.
  const ticketCount = placements.tickets.length;

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
          onSceneEmitter={setSceneEmitter}
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
      <QueuePanel roomId={queueRoom} items={queueItems} onClose={() => setQueueRoom(null)} />
      <TopHudBar
        projectName={activeProject?.name ?? '—'}
        ticketCount={ticketCount}
        systemLoadPct={64}
      />
      <EventFeedSidebar />
      <BottomHudBar hero={null} team={team} />
    </div>
  );
}
