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
import { FLOOR_PIXEL_WIDTH, floorCenterY, totalWorldHeight } from '../lib/layout';
import { queueVerifiedPngAssets } from './asset-loader';
import { ChoreographyPlayer } from './choreography/ChoreographyPlayer';
import { PersonaLayer } from './layers/PersonaLayer';
import { RoomLayer } from './layers/RoomLayer';
import { TicketLayer } from './layers/TicketLayer';
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
  private choreographyPlayer!: ChoreographyPlayer;

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
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0d0a13');
    ensureOfficeTextures(this);

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

    this.choreographyPlayer = new ChoreographyPlayer({
      personaLayer: this.personaLayer,
      ticketLayer: this.ticketLayer,
      roomLayer: this.roomLayer,
      scene: this,
      emitter: this.emitter,
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
    this.roomLayer.applyProjects(this.projects);
    this.personaLayer.dropAll();
    this.ticketLayer.dropAll();

    const worldH = Math.max(totalWorldHeight(this.projects.length), this.scale.height);
    this.cameras.main.setBounds(0, 0, FLOOR_PIXEL_WIDTH, worldH);
    if (this.currentFloorIndex >= this.projects.length) this.currentFloorIndex = 0;
    this.snapCameraToFloor(this.currentFloorIndex);
  }

  /**
   * Drop / add / move personas and tickets to match the new placement data.
   * Personas must settle before tickets so tickets can read persona positions.
   */
  applyPlacements(result: { personas: PersonaPlacement[]; tickets: TicketPlacement[] }): void {
    this.personaLayer.applyPlacements(result.personas);
    this.ticketLayer.applyPlacements(result.tickets);
    this.roomLayer.refreshIdleDeskIndicators(this.personaLayer.occupiedDeskKeys());
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
      floorCenterY(floorIndex),
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
    this.cameras.main.centerOn(FLOOR_PIXEL_WIDTH / 2, floorCenterY(floorIndex));
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
    if (this.projects.length > 0) {
      this.snapCameraToFloor(this.currentFloorIndex);
    }
  }
}
