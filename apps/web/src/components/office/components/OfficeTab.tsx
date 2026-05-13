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
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeskClickPayload, FloorChangePayload, OfficeProject } from '../game/OfficeScene';
import { placementsFromItems } from '../lib/agent-positions';
import { DeskDetailPanel } from './DeskDetailPanel';
import { FloorIndicator } from './FloorIndicator';
import { OfficeGameMount } from './OfficeGameMount';

interface OfficeTabProps {
  /** Project to focus the camera on initially. */
  initialProjectSlug?: string;
}

export function OfficeTab({ initialProjectSlug }: OfficeTabProps) {
  const queryClient = useQueryClient();
  const [activeSlug, setActiveSlug] = useState<string | null>(initialProjectSlug ?? null);
  const [floorIndex, setFloorIndex] = useState(0);
  const [deskPayload, setDeskPayload] = useState<DeskClickPayload | null>(null);

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

  // SSE: invalidate the issues query when any state transitions so placements
  // re-derive. Match the Board.tsx pattern of subscribing to the unfiltered
  // /events stream when there's no single active project.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/events');
    const onTransition = () => {
      void queryClient.invalidateQueries({ queryKey: ['office-issues'] });
    };
    es.addEventListener('state.transitioned', onTransition);
    return () => {
      es.removeEventListener('state.transitioned', onTransition);
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
      <OfficeGameMount
        projects={officeProjects}
        placements={placements}
        activeProjectSlug={activeSlug}
        onDeskClick={handleDeskClick}
        onFloorChange={handleFloorChange}
      />
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
