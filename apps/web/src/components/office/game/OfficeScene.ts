// Thin Phaser scene: lifecycle, input, camera, and composition of FloorLayer
// + SpriteLayer. All floor and sprite logic lives in those layers.
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
import type { AgentPlacement } from '../lib/agent-positions';
import { FLOOR_PIXEL_WIDTH, floorCenterY, totalWorldHeight } from '../lib/layout';
import { queueVerifiedPngAssets } from './asset-loader';
import { FloorLayer } from './layers/FloorLayer';
import { SpriteLayer } from './layers/SpriteLayer';
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
  private floorLayer!: FloorLayer;
  private spriteLayer!: SpriteLayer;

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

    // Layers constructed before 'ready' so click handlers are wired when the
    // React mount's once('ready') callback pushes the first applyProjects.
    this.floorLayer = new FloorLayer(this, this.emitter, {
      navigateFloor: (delta) => this.navigateFloor(delta),
      getPlacements: () => this.spriteLayer.getPlacements(),
    });
    this.spriteLayer = new SpriteLayer(this, this.emitter, {
      getProjects: () => this.projects,
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
   * Replace the project list. Re-builds floors, banners, desks, and
   * stair-click zones. Idempotent — diffing isn't worth it given the small
   * project count (<10 in practice).
   */
  applyProjects(projects: readonly OfficeProject[]): void {
    this.projects = projects.slice();
    this.floorLayer.applyProjects(this.projects);
    // Existing sprites lose their floor binding — drop them; the next
    // applyPlacements call will recreate as needed.
    this.spriteLayer.dropAll();

    const worldH = Math.max(totalWorldHeight(this.projects.length), this.scale.height);
    this.cameras.main.setBounds(0, 0, FLOOR_PIXEL_WIDTH, worldH);
    if (this.currentFloorIndex >= this.projects.length) this.currentFloorIndex = 0;
    this.snapCameraToFloor(this.currentFloorIndex);
  }

  /**
   * Drop / add / move sprites to match the new placement list.
   */
  applyPlacements(placements: readonly AgentPlacement[]): void {
    this.spriteLayer.applyPlacements(placements);
    this.floorLayer.refreshIdleDeskIndicators(this.spriteLayer.occupiedDeskKeys());
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
