// Thin Phaser scene: lifecycle, input, camera, and composition of RoomLayer
// + PersonaLayer + TicketLayer. All floor and sprite logic lives in those layers.
//
// Wiring contract:
//   - React owns the React state (active project, work items, projects list)
//     and pushes data into the scene via `applyProjects`, `applyPlacements`,
//     `panToProject`, etc.
//   - The scene emits user-interaction events back via `emitter.emit('desk-click', ...)`
//     and `emitter.emit('floor-change', ...)`.
//
// The scene never imports React. The mount component (`OfficeGameMount.tsx`)
// owns the bridge in both directions.

import Phaser from 'phaser';
import type { PersonaPlacement, TicketPlacement } from '../lib/agent-positions';
import type { Timeline } from '../lib/choreography';
import { type HudState, hudStateFromPlacements } from '../lib/hud-state';
import {
  FLOOR_PIXEL_WIDTH,
  FLOOR_VISIBLE_TOP_TRIM,
  floorOriginY,
  floorOverviewCameraLayout,
} from '../lib/layout';
import { queueVerifiedPngAssets } from './asset-loader';
import { ChoreographyPlayer } from './choreography/ChoreographyPlayer';
import { AmbientLayer } from './layers/AmbientLayer';
import { HudLayer } from './layers/HudLayer';
import { PersonaLayer } from './layers/PersonaLayer';
import { RoomLayer } from './layers/RoomLayer';
import { TicketLayer } from './layers/TicketLayer';
import { generateOfficeFloorTexture } from './static-floor-texture';
import { ensureOfficeTextures } from './textures';

// Re-export types so the React mount (OfficeGameMount.tsx) doesn't need
// import-path changes.
export type {
  DeskClickPayload,
  FloorChangePayload,
  OfficeProject,
  VerifiedAsset,
} from './layers/types';

// Re-import for internal use.
import type { FloorChangePayload, OfficeProject, VerifiedAsset } from './layers/types';

export class OfficeScene extends Phaser.Scene {
  private readonly emitter = new Phaser.Events.EventEmitter();
  private projects: OfficeProject[] = [];
  private currentFloorIndex = 0;
  private resizeListener?: () => void;
  private verifiedAssets: VerifiedAsset[] = [];
  private roomLayer!: RoomLayer;
  private personaLayer!: PersonaLayer;
  private ticketLayer!: TicketLayer;
  private ambientLayer!: AmbientLayer;
  private choreographyPlayer!: ChoreographyPlayer;
  private hudLayer!: HudLayer;
  private lastHudState: HudState | null = null;

  constructor() {
    super({ key: 'OfficeScene' });
  }

  /** External event bus — the React mount listens here. */
  events_(): Phaser.Events.EventEmitter {
    return this.emitter;
  }

  /**
   * Inject the list of PixelLab PNGs that the React mount has confirmed exist
   * on disk. Called before adding the scene to the Game so they're queued in
   * `preload`. Empty list → procedural textures are the sole source.
   */
  setVerifiedAssets(entries: readonly VerifiedAsset[]): void {
    this.verifiedAssets = entries.slice();
  }

  preload(): void {
    queueVerifiedPngAssets(this, this.verifiedAssets);
    // Goose walking spritesheet — the PNG is 64×32 packing 4 horizontally-
    // arranged walk-cycle frames at 16×32 each (matches the asset manifest
    // entry in scripts/generate-office-assets.ts). Loading with frameWidth=32
    // would slice 2 frames per Phaser frame, producing the "two blue birds"
    // composite the player sees.
    this.load.spritesheet('office:goose-walk', '/office/goose_walk_sheet.png', {
      frameWidth: 16,
      frameHeight: 32,
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2c2a2e');
    ensureOfficeTextures(this);
    // Bake the static floor (brick floor, walls, doors, lighting, per-room
    // backboards) into a single texture. RoomLayer uses it as the base layer.
    generateOfficeFloorTexture(this);

    // Register the 4-frame goose walking animation (used by AmbientLayer and
    // PersonaLayer). No-op if the spritesheet didn't load (then geese fall
    // back to the static idle texture).
    if (this.textures.exists('office:goose-walk') && !this.anims.exists('goose-walk')) {
      this.anims.create({
        key: 'goose-walk',
        frames: this.anims.generateFrameNumbers('office:goose-walk', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }

    // Construction order: RoomLayer → PersonaLayer → TicketLayer (ascending z).
    // All layers are constructed before the first 'ready' emit so click handlers
    // are wired when the React mount's once('ready') callback pushes initial data.
    this.roomLayer = new RoomLayer(this, {
      navigateFloor: (delta) => this.navigateFloor(delta),
    });

    this.personaLayer = new PersonaLayer(this, this.emitter, {
      getProjects: () => this.projects,
    });

    this.ticketLayer = new TicketLayer(this, this.emitter, {
      personaLayer: this.personaLayer,
      setHeroTicketCell: (text) => this.roomLayer.setHeroTicketCell(text),
      getFloorIndex: (slug) => this.floorIndexFor(slug),
    });

    // Ambient/decorative geese (Phase 5 — coffee loop). Independent of
    // work-driven personas; spawn / wander / return purely for atmosphere.
    this.ambientLayer = new AmbientLayer(this);

    this.choreographyPlayer = new ChoreographyPlayer({
      personaLayer: this.personaLayer,
      ticketLayer: this.ticketLayer,
      roomLayer: this.roomLayer,
      scene: this,
      emitter: this.emitter,
      notifyCameraAnchor: (anchor, ticketId) => this.notifyCameraAnchor(anchor, ticketId),
    });

    // HudLayer constructed last — sits at top of z-stack (z=60)
    this.hudLayer = new HudLayer(this, this.emitter, (updated) => {
      this.lastHudState = updated;
      this.emitter.emit('hud-state-updated', updated);
    });

    this.input.keyboard?.on('keydown-UP', () => {
      this.navigateFloor(-1);
    });
    this.input.keyboard?.on('keydown-DOWN', () => {
      this.navigateFloor(+1);
    });

    this.scale.on('resize', this.handleResize, this);

    // Signal the React mount that the scene is fully wired and safe to push
    // initial data into. Emitted on our own emitter (not `this.events`) so
    // listeners attached pre-boot still receive it.
    this.emitter.emit('ready');
  }

  shutdown(): void {
    this.scale.off('resize', this.handleResize, this);
    this.hudLayer?.destroy();
    this.ambientLayer?.destroyAll();
    this.emitter.removeAllListeners();
    if (this.resizeListener) window.removeEventListener('resize', this.resizeListener);
  }

  /**
   * Replace the project list. Re-builds all floor rooms and resets sprites.
   * Accepts a single OfficeProject (per spec: applyProjects is NOT an array
   * in the spec sense — the scene manages a list internally).
   */
  applyProjects(projects: readonly OfficeProject[]): void {
    this.projects = projects.slice();
    if (this.roomLayer == null || this.personaLayer == null || this.ticketLayer == null) return;
    this.roomLayer.applyProjects(this.projects);
    this.personaLayer.dropAll();
    this.ticketLayer.dropAll();
    this.ambientLayer?.applyProjects(this.projects);

    this.fitCameraToViewport();
    if (this.currentFloorIndex >= this.projects.length) this.currentFloorIndex = 0;
    this.snapCameraToFloor(this.currentFloorIndex);
  }

  /**
   * Drop / add / move personas and tickets to match the new placement data.
   * Personas must settle before tickets so tickets can read persona positions.
   *
   * Guard: callable from React effects that may fire before Phaser has run
   * `create()` and built the layers. Silently no-op until layers exist; the
   * boot path replays initial data via the `'ready'` callback.
   */
  applyPlacements(result: { personas: PersonaPlacement[]; tickets: TicketPlacement[] }): void {
    if (this.personaLayer == null || this.ticketLayer == null || this.roomLayer == null) return;
    this.personaLayer.applyPlacements(result.personas);
    this.ticketLayer.applyPlacements(result.tickets);
    this.roomLayer.refreshIdleDeskIndicators(this.personaLayer.occupiedDeskKeys());

    // Derive and push HUD state on every placement diff
    const hudState = hudStateFromPlacements(result.personas, result.tickets, this.lastHudState, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    this.applyHud(hudState);
  }

  /** Push a fully-computed HudState into all HUD consumers. */
  applyHud(state: HudState): void {
    this.lastHudState = state;
    this.hudLayer.setFloorIndex(this.currentFloorIndex);
    this.hudLayer.applyHud(state);
    this.roomLayer.applyPressure(state.pressure);

    // Update hero codename label with priority tint (preserve the persona's own codename text)
    if (state.hero?.personaId != null) {
      this.personaLayer.setHeroCodename(state.hero.personaId, state.hero.priority);
    }

    // Position blocked-persona spotlights
    for (const { personaId } of state.blocked) {
      const pos = this.personaLayer.getCarrierPosition(personaId);
      if (pos != null) {
        this.hudLayer.positionSpotlight(personaId, pos.x, pos.y);
      }
    }

    // Emit HUD state to React (HudFeed subscribes via the emitter bridge)
    this.emitter.emit('hud-state-updated', state);
  }

  /**
   * Pan the camera to the project's floor with a smooth animation.
   */
  panToProject(slug: string): void {
    const idx = this.floorIndexFor(slug);
    if (idx < 0) return;
    this.panToFloor(idx);
  }

  /** Programmatic floor change — also fires `floor-change`. */
  panToFloor(floorIndex: number): void {
    if (floorIndex < 0 || floorIndex >= this.projects.length) return;
    this.currentFloorIndex = floorIndex;
    this.cameras.main.pan(
      FLOOR_PIXEL_WIDTH / 2,
      this.floorViewportCenterY(floorIndex),
      400,
      Phaser.Math.Easing.Cubic.InOut,
    );
    const project = this.projects[floorIndex];
    this.emitter.emit('floor-change', {
      floorIndex,
      projectSlug: project.slug,
      projectName: project.name,
    } satisfies FloorChangePayload);
  }

  applyChoreography(timelines: Timeline[]): void {
    this.choreographyPlayer.applyChoreography(timelines);
  }

  /** Called (e.g. by ChoreographyPlayer's cameraTo intent) when camera anchor changes. */
  notifyCameraAnchor(anchor: 'floor-overview' | 'hero-ticket-follow', ticketId?: string): void {
    if (this.hudLayer != null) {
      this.hudLayer.applyCameraState(anchor, ticketId);
    }
    if (this.lastHudState != null) {
      this.lastHudState = { ...this.lastHudState, camera: { anchor, ticketId } };
    }
  }

  navigateFloor(delta: number): void {
    const next = Phaser.Math.Clamp(
      this.currentFloorIndex + delta,
      0,
      Math.max(0, this.projects.length - 1),
    );
    if (next !== this.currentFloorIndex) this.panToFloor(next);
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private floorIndexFor(slug: string): number {
    return this.projects.findIndex((p) => p.slug === slug);
  }

  private snapCameraToFloor(floorIndex: number): void {
    if (this.projects.length === 0) return;
    this.cameras.main.centerOn(FLOOR_PIXEL_WIDTH / 2, this.floorViewportCenterY(floorIndex));
    const project = this.projects[floorIndex];
    if (project) {
      this.emitter.emit('floor-change', {
        floorIndex,
        projectSlug: project.slug,
        projectName: project.name,
      } satisfies FloorChangePayload);
    }
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.cameras.main.setSize(gameSize.width, gameSize.height);
    this.fitCameraToViewport(gameSize.width, gameSize.height);
    if (this.projects.length > 0) {
      this.snapCameraToFloor(this.currentFloorIndex);
    }
  }

  private fitCameraToViewport(width = this.scale.width, height = this.scale.height): void {
    const cameraLayout = floorOverviewCameraLayout(width, height, this.projects.length);
    this.cameras.main.setZoom(cameraLayout.zoom);
    this.cameras.main.setBounds(
      cameraLayout.bounds.x,
      cameraLayout.bounds.y,
      cameraLayout.bounds.width,
      cameraLayout.bounds.height,
    );
  }

  private floorViewportCenterY(floorIndex: number): number {
    const visibleWorldHeight = this.cameras.main.height / this.cameras.main.zoom;
    return floorOriginY(floorIndex) + FLOOR_VISIBLE_TOP_TRIM + visibleWorldHeight / 2;
  }
}
