// React-side bridge for the Phaser Office scene.
//
// Responsibilities:
//   - Create one Phaser.Game per mount, sized to fill its container.
//   - Push project-list + placement-list updates into the scene.
//   - Surface scene-emitted events (desk-click, floor-change) up to React.
//   - Tear down cleanly on unmount.
//
// The game instance itself is preserved across React re-renders by storing it
// on a ref; React re-renders only push diffs through `applyProjects` /
// `applyPlacements`.

import Phaser from 'phaser';
import { type MutableRefObject, useEffect, useRef } from 'react';
import type { DeskClickPayload, FloorChangePayload, OfficeProject } from '../game/OfficeScene';
import { OfficeScene } from '../game/OfficeScene';
import { probeOfficePngAssets } from '../game/asset-loader';
import type { PersonaPlacement, TicketPlacement } from '../lib/agent-positions';
import type { Timeline } from '../lib/choreography';

interface OfficeGameMountProps {
  projects: readonly OfficeProject[];
  placements: { personas: PersonaPlacement[]; tickets: TicketPlacement[] };
  /** Slug of the project whose floor the camera should focus on. */
  activeProjectSlug: string | null;
  onDeskClick: (payload: DeskClickPayload) => void;
  onFloorChange: (payload: FloorChangePayload) => void;
  /** If provided, set to a function that pushes timelines into the scene. Set to null on unmount. */
  choreographyRef?: MutableRefObject<((timelines: Timeline[]) => void) | null>;
  /** If provided, called with the scene emitter once ready, then null on unmount. */
  onSceneEmitter?: (emitter: Phaser.Events.EventEmitter | null) => void;
  /** Called when the hero ticket changes (promoted or released). */
  onHeroChanged?: (ticketId: string | null) => void;
}

export function OfficeGameMount({
  projects,
  placements,
  activeProjectSlug,
  onDeskClick,
  onFloorChange,
  choreographyRef,
  onHeroChanged,
  onSceneEmitter,
}: OfficeGameMountProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<import('phaser').Game | null>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const onDeskClickRef = useRef(onDeskClick);
  const onFloorChangeRef = useRef(onFloorChange);
  // Stash the prop snapshot the boot effect should use as its initial push.
  // We read these via `.current` inside the boot IIFE so the effect itself has
  // no React-state deps and the boot stays one-shot per mount.
  const initialProjectsRef = useRef(projects);
  const initialPlacementsRef = useRef(placements);
  const initialActiveSlugRef = useRef(activeProjectSlug);
  // Always-fresh slug ref so the projects effect can pan without listing
  // activeProjectSlug as a dep (which would trigger applyProjects rebuilds
  // on every floor navigation — see Codex P1 review on PR #765).
  const activeSlugRef = useRef(activeProjectSlug);

  const onHeroChangedRef = useRef(onHeroChanged);

  // Keep the latest callbacks in refs so the scene listeners (set up once)
  // always invoke the current React handlers.
  useEffect(() => {
    onDeskClickRef.current = onDeskClick;
    onFloorChangeRef.current = onFloorChange;
    onHeroChangedRef.current = onHeroChanged;
  }, [onDeskClick, onFloorChange, onHeroChanged]);

  // Boot Phaser once per mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: choreographyRef is a stable MutableRefObject; boot effect is intentionally one-shot with no deps
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (container == null) return;

    let cleanup: (() => void) | undefined;
    void (async () => {
      // Probe for PixelLab PNGs first; the scene queues only verified assets
      // in preload() to avoid Phaser's noisy 404 console.errors.
      const verified = await probeOfficePngAssets();
      if (cancelled || containerRef.current == null) return;
      const scene = new OfficeScene();
      scene.setVerifiedAssets(verified);
      sceneRef.current = scene;
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        backgroundColor: '#0d0a13',
        scale: {
          mode: Phaser.Scale.RESIZE,
          width: container.clientWidth || 800,
          height: container.clientHeight || 480,
        },
        scene: [scene],
        pixelArt: true,
        banner: false,
      });
      gameRef.current = game;
      const resizeObserver =
        typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(([entry]) => {
              if (entry == null) return;
              const width = Math.floor(entry.contentRect.width);
              const height = Math.floor(entry.contentRect.height);
              if (width > 0 && height > 0) game.scale.resize(width, height);
            })
          : null;
      resizeObserver?.observe(container);
      // Dev-only debug hook so e2e screenshot tests + manual debugging can
      // push events into the scene without going through Phaser hit-testing.
      // Stripped at build time when import.meta.env.DEV is false.
      if (import.meta.env.DEV) {
        (window as unknown as { __officeScene?: OfficeScene }).__officeScene = scene;
      }
      const onDesk = (p: DeskClickPayload) => onDeskClickRef.current(p);
      const onFloor = (p: FloorChangePayload) => onFloorChangeRef.current(p);
      const onHero = (ticketId: string | null) => onHeroChangedRef.current?.(ticketId);
      // Attach desk/floor listeners on the scene's own emitter (a class field,
      // safe to subscribe to immediately) and push initial data once the
      // scene signals it's `create`-complete by emitting `'ready'`.
      scene.events_().on('desk-click', onDesk);
      scene.events_().on('floor-change', onFloor);
      scene.events_().on('hero-changed', onHero);
      scene.events_().once('ready', () => {
        // Initial push from refs so the boot effect has no React-state deps.
        scene.applyProjects(initialProjectsRef.current);
        scene.applyPlacements(initialPlacementsRef.current);
        const initialSlug = initialActiveSlugRef.current;
        if (initialSlug != null) scene.panToProject(initialSlug);
        if (choreographyRef != null) {
          choreographyRef.current = (timelines) => scene.applyChoreography(timelines);
        }
        onSceneEmitter?.(scene.events_());
      });
      cleanup = () => {
        scene.events_().off('desk-click', onDesk);
        scene.events_().off('floor-change', onFloor);
        scene.events_().off('hero-changed', onHero);
        if (choreographyRef != null) choreographyRef.current = null;
        onSceneEmitter?.(null);
        resizeObserver?.disconnect();
        game.destroy(true);
        sceneRef.current = null;
        gameRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Keep the activeSlugRef current so the projects effect can read it
  // without listing it as a dep (would force a full rebuild on floor nav).
  useEffect(() => {
    activeSlugRef.current = activeProjectSlug;
  }, [activeProjectSlug]);

  // Push project list updates. NOTE: do NOT include activeProjectSlug in the
  // deps — applyProjects is a full-rebuild that destroys every sprite, so it
  // must only run when the project list itself changes. We re-pan the camera
  // here after the rebuild because applyProjects snaps to floor 0 by default,
  // which would clobber the URL-driven activeProjectSlug otherwise.
  useEffect(() => {
    sceneRef.current?.applyProjects(projects);
    if (activeSlugRef.current != null) sceneRef.current?.panToProject(activeSlugRef.current);
  }, [projects]);

  // Push placement updates.
  useEffect(() => {
    sceneRef.current?.applyPlacements(placements);
  }, [placements]);

  // Camera follow on active-project change without rebuilding floors.
  useEffect(() => {
    if (activeProjectSlug != null) sceneRef.current?.panToProject(activeProjectSlug);
  }, [activeProjectSlug]);

  return (
    <div
      ref={containerRef}
      data-testid="office-canvas"
      className="w-full h-full bg-[#0d0a13]"
      style={{ minHeight: 320 }}
    />
  );
}
