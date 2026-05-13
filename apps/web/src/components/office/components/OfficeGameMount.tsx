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
import { useEffect, useRef } from 'react';
import type { DeskClickPayload, FloorChangePayload, OfficeProject } from '../game/OfficeScene';
import { OfficeScene } from '../game/OfficeScene';
import type { AgentPlacement } from '../lib/agent-positions';

interface OfficeGameMountProps {
  projects: readonly OfficeProject[];
  placements: readonly AgentPlacement[];
  /** Slug of the project whose floor the camera should focus on. */
  activeProjectSlug: string | null;
  onDeskClick: (payload: DeskClickPayload) => void;
  onFloorChange: (payload: FloorChangePayload) => void;
}

export function OfficeGameMount({
  projects,
  placements,
  activeProjectSlug,
  onDeskClick,
  onFloorChange,
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

  // Keep the latest callbacks in refs so the scene listeners (set up once)
  // always invoke the current React handlers.
  useEffect(() => {
    onDeskClickRef.current = onDeskClick;
    onFloorChangeRef.current = onFloorChange;
  }, [onDeskClick, onFloorChange]);

  // Boot Phaser once per mount.
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (container == null) return;

    if (cancelled) return;
    const scene = new OfficeScene();
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
    const onDesk = (p: DeskClickPayload) => onDeskClickRef.current(p);
    const onFloor = (p: FloorChangePayload) => onFloorChangeRef.current(p);
    // Wait for scene `create` so the emitter is ready.
    scene.events.once('create', () => {
      scene.events_().on('desk-click', onDesk);
      scene.events_().on('floor-change', onFloor);
      // Initial push from refs so the boot effect has no React-state deps.
      scene.applyProjects(initialProjectsRef.current);
      scene.applyPlacements(initialPlacementsRef.current);
      const initialSlug = initialActiveSlugRef.current;
      if (initialSlug != null) scene.panToProject(initialSlug);
    });

    return () => {
      cancelled = true;
      scene.events_().off('desk-click', onDesk);
      scene.events_().off('floor-change', onFloor);
      game.destroy(true);
      sceneRef.current = null;
      gameRef.current = null;
    };
  }, []);

  // Push project list updates. NOTE: do NOT include activeProjectSlug here
  // — applyProjects is a full-rebuild that destroys every sprite, so it must
  // only run when the project list itself changes. Camera pans live in their
  // own effect below.
  useEffect(() => {
    sceneRef.current?.applyProjects(projects);
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
