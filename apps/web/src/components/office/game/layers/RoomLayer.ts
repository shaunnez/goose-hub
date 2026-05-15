// Room geometry owner: renders the 11 canonical v2 project floor rooms
// arranged in two bands (top: 6 rooms, bottom: 5 rooms) with a middle
// corridor band. All coordinates are imported from lib/rooms.ts — no
// literals here.
//
// Public contract:
//   applyProjects(projects)              — full rebuild of all floor blocks
//   refreshIdleDeskIndicators(keys)      — show/hide idle coffee indicators
//   setHeroTicketCell(text)              — update banner R-cell hero ticket label
//   destroyAll()                         — tear down on scene shutdown

import type Phaser from 'phaser';
import { DEFAULT_EASE, PARTICLE_ALPHA_EASE } from '../../lib/cinematic-timings';
import { FLOOR_PIXEL_WIDTH, TILE_SIZE, floorOriginY } from '../../lib/layout';
import {
  BOTTOM_BAND_ROOMS,
  BOTTOM_BAND_Y,
  BOTTOM_INTER_ROOM_WALL_X,
  CORRIDOR_WALK_Y,
  CORRIDOR_Y,
  FLOOR_WORLD,
  LIBRARY_BOUNDS,
  ROOM_IDS,
  type RoomId,
  TOP_BAND_ROOMS,
  TOP_BAND_Y,
  TOP_INTER_ROOM_WALL_X,
  allClickZones,
  pressureColorForCount,
  roomBand,
  roomBounds,
  roomDeskAnchors,
  roomDoor,
  roomQueueAnchor,
} from '../../lib/rooms';
import { HUD_TINTS, PALETTE, TEXTURE_KEYS, applyOfficeTextureDisplaySize } from '../textures';
import type { IntentResult, OfficeProject } from './types';

interface RoomLayerCallbacks {
  navigateFloor: (delta: number) => void;
}

// Door gap is 2 tiles wide, centered on door.x; half-width used for rect.
const DOOR_WIDTH = TILE_SIZE * 2;
// Depth for effects (corridor pulse, glow, particles) — above tickets.
const EFFECT_DEPTH = 55;

interface DoorEntry {
  graphics: Phaser.GameObjects.Graphics;
  cancelFn?: () => void;
}

interface WallTintEntry {
  graphics: Phaser.GameObjects.Graphics;
  cancelFn?: () => void;
}

interface EffectEntry {
  objects: Phaser.GameObjects.GameObject[];
  cancel: () => void;
}

// Pixel rows relative to floor origin (ty × TILE_SIZE) for the v2 layout.
const ROW_TOP_WALL = 0; // y=0..15  outer top wall
const ROW_BANNER_TOP = TILE_SIZE; // y=16..63 project banner
const ROW_TOP_BAND_CEILING = TILE_SIZE * 4; // y=64..79 top band ceiling
const ROW_TOP_BAND_SOUTH_WALL = TOP_BAND_Y.y2 + 1; // y=256
const ROW_BOTTOM_BAND_NORTH_WALL = CORRIDOR_Y.y2 + 1; // y=336
const ROW_BOTTOM_BAND_SOUTH_WALL = BOTTOM_BAND_Y.y2 + 1; // y=528 = ROW_BOTTOM_WALL
const ROW_BOTTOM_WALL = ROW_BOTTOM_BAND_SOUTH_WALL;

// Each door gap is 2 tiles wide; half-width for centering
const DOOR_HALF_WIDTH = TILE_SIZE;

// Banner R-cell: hero ticket display (px 848..1263, right-aligned, 12px)
const BANNER_HERO_X = 1263;

export class RoomLayer {
  private readonly scene: Phaser.Scene;
  private readonly callbacks: RoomLayerCallbacks;
  private projects: readonly OfficeProject[] = [];
  private floorContainers: Phaser.GameObjects.Container[] = [];
  private clickZones: Phaser.GameObjects.Zone[] = [];
  /** Banner R-cell texts, one per floor (hero ticket display). */
  private heroTicketTexts: Phaser.GameObjects.Text[] = [];
  /** Door graphics per floor — keyed by floorIndex. */
  private doorEntries: Map<number, DoorEntry> = new Map();
  /** Wall tint overlays per (floorIndex, roomId). */
  private wallTintEntries: Map<string, WallTintEntry> = new Map();
  /** One-shot effect objects keyed by effect id. */
  private effectEntries: Map<string, EffectEntry> = new Map();
  /** Phase 6: per-room floor-pressure tint overlays keyed by "floorIndex:roomId". */
  private pressureGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();

  constructor(scene: Phaser.Scene, callbacks: RoomLayerCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  applyProjects(projects: readonly OfficeProject[]): void {
    this.projects = projects;
    this.destroyAll();
    for (let i = 0; i < projects.length; i++) {
      this.buildFloor(i, projects[i]);
    }
  }

  refreshIdleDeskIndicators(occupiedKeys: ReadonlySet<string>): void {
    for (const c of this.floorContainers) {
      const children = c.list as Phaser.GameObjects.GameObject[];
      for (const child of children) {
        const obj = child as Phaser.GameObjects.Image;
        if (obj.getData?.('kind') !== 'idle-indicator') continue;
        const key = `${String(obj.getData('floorIndex'))}:${String(obj.getData('deskKey'))}`;
        obj.setVisible(!occupiedKeys.has(key));
      }
    }
  }

  /**
   * Updates the banner R-cell (hero ticket display) on all floor banners.
   * Passing null clears the cell.
   */
  setHeroTicketCell(text: string | null): void {
    for (const t of this.heroTicketTexts) {
      t.setText(text ?? '');
      t.setVisible(text != null && text.length > 0);
    }
  }

  /**
   * Phase 6: Apply per-room floor-pressure tint. Modulates room floor-tile
   * group colour based on in-flight ticket count.
   * This is the ONLY HUD-driven write into RoomLayer from the scene.
   */
  applyPressure(perRoom: Record<RoomId, number>): void {
    for (let fi = 0; fi < this.projects.length; fi++) {
      const oy = floorOriginY(fi);
      for (const roomId of ROOM_IDS) {
        const count = perRoom[roomId] ?? 0;
        const color = pressureColorForCount(count);
        const key = `${fi}:${roomId}`;
        const bounds = roomBounds(roomId);
        const x = bounds.x1;
        const y = oy + bounds.y1;
        const w = bounds.x2 - bounds.x1;
        const h = bounds.y2 - bounds.y1;

        let g = this.pressureGraphics.get(key);
        if (g == null) {
          g = this.scene.add.graphics();
          g.setDepth(1); // just above floor tiles but below desks
          this.pressureGraphics.set(key, g);
        }
        g.clear();
        if (count > 0) {
          g.fillStyle(color, 0.22);
          g.fillRect(x, y, w, h);
        }
      }
    }
  }

  destroyAll(): void {
    for (const c of this.floorContainers) c.destroy();
    this.floorContainers = [];
    for (const z of this.clickZones) z.destroy();
    this.clickZones = [];
    this.heroTicketTexts = [];
    for (const e of this.doorEntries.values()) {
      e.cancelFn?.();
      e.graphics.destroy();
    }
    this.doorEntries.clear();
    for (const e of this.wallTintEntries.values()) {
      e.cancelFn?.();
      e.graphics.destroy();
    }
    this.wallTintEntries.clear();
    for (const e of this.effectEntries.values()) e.cancel();
    this.effectEntries.clear();
    for (const g of this.pressureGraphics.values()) g.destroy();
    this.pressureGraphics.clear();
  }

  // ─── Phase 5 cinematic primitives ─────────────────────────────────────────

  /**
   * Animate the Review chamber door: 'open' fades it out, 'close' fades it in.
   * Returns a promise that resolves when the animation completes.
   * Calling cancel() on the returned object stops and resets the door.
   */
  animateDoor(
    floorIndex: number,
    targetState: 'open' | 'close',
    durationMs: number,
  ): { promise: Promise<IntentResult>; cancel: () => void } {
    let doorEntry = this.doorEntries.get(floorIndex);
    if (!doorEntry) {
      doorEntry = this.buildDoorGraphics(floorIndex);
    }
    const entry: DoorEntry = doorEntry;
    const targetAlpha = targetState === 'open' ? 0 : 1;
    const g = entry.graphics;
    let settled = false;
    let resolve!: (r: IntentResult) => void;
    const promise = new Promise<IntentResult>((r) => {
      resolve = r;
    });
    const tween = this.scene.tweens.add({
      targets: g,
      alpha: targetAlpha,
      duration: durationMs,
      ease: DEFAULT_EASE,
      onComplete: () => {
        if (settled) return;
        settled = true;
        entry.cancelFn = undefined;
        resolve({ status: 'completed' });
      },
    });
    const cancel = () => {
      if (settled) return;
      settled = true;
      tween.stop();
      entry.cancelFn = undefined;
      resolve({ status: 'cancelled' });
    };
    entry.cancelFn = cancel;
    return { promise, cancel };
  }

  /** Restores the door to closed (alpha=1) without animation. */
  resetDoor(floorIndex: number): void {
    const entry = this.doorEntries.get(floorIndex);
    if (!entry) return;
    entry.cancelFn?.();
    entry.graphics.setAlpha(1);
  }

  /**
   * Sets a semi-transparent wall tint overlay on a room (alpha 0..1).
   * Pass alpha=0 to clear. The overlay is created lazily.
   */
  setWallTint(floorIndex: number, roomId: RoomId, alpha: number): void {
    const key = `${floorIndex}:${roomId}`;
    let entry = this.wallTintEntries.get(key);
    if (!entry) {
      entry = this.buildWallTintGraphics(floorIndex, roomId);
    }
    entry.graphics.setAlpha(alpha);
  }

  /** Restores a wall tint to transparent (alpha=0). */
  restoreWallTint(floorIndex: number, roomId: RoomId): void {
    const key = `${floorIndex}:${roomId}`;
    const entry = this.wallTintEntries.get(key);
    if (entry) {
      entry.cancelFn?.();
      entry.graphics.setAlpha(0);
    }
  }

  /**
   * Sweeps a coloured horizontal pulse along the corridor (at corridorY in world coords).
   * fromWorldX → toWorldX; direction is implied by sign of (to - from).
   */
  corridorPulse(
    effectId: string,
    fromWorldX: number,
    toWorldX: number,
    worldY: number,
    durationMs: number,
    color: number,
  ): { promise: Promise<IntentResult>; cancel: () => void } {
    const existing = this.effectEntries.get(effectId);
    existing?.cancel();

    const g = this.scene.add.graphics();
    g.setDepth(EFFECT_DEPTH);
    g.fillStyle(color, 0.7);
    const barH = TILE_SIZE;
    const barW = Math.abs(toWorldX - fromWorldX) * 0.08;
    g.fillRect(0, -barH / 2, barW, barH);
    g.setPosition(fromWorldX, worldY);

    let settled = false;
    let resolveFn!: (r: IntentResult) => void;
    const promise = new Promise<IntentResult>((r) => {
      resolveFn = r;
    });

    const tween = this.scene.tweens.add({
      targets: g,
      x: toWorldX,
      alpha: { from: 0.9, to: 0 },
      duration: durationMs,
      ease: 'Linear',
      onComplete: () => {
        if (settled) return;
        settled = true;
        g.destroy();
        this.effectEntries.delete(effectId);
        resolveFn({ status: 'completed' });
      },
    });

    const cancel = () => {
      if (settled) return;
      settled = true;
      tween.stop();
      g.destroy();
      this.effectEntries.delete(effectId);
      resolveFn({ status: 'cancelled' });
    };

    this.effectEntries.set(effectId, { objects: [g], cancel });
    return { promise, cancel };
  }

  /**
   * Radial glow ring at (worldX, worldY). Expands from 0 to maxRadius with alpha fade.
   */
  glowRingAt(
    effectId: string,
    worldX: number,
    worldY: number,
    durationMs: number,
    color: number,
  ): { promise: Promise<IntentResult>; cancel: () => void } {
    const existing = this.effectEntries.get(effectId);
    existing?.cancel();

    const g = this.scene.add.graphics();
    g.setDepth(EFFECT_DEPTH);
    g.setPosition(worldX, worldY);

    const proxyAlpha = { value: 0.8 };
    const proxyRadius = { value: 2 };
    let settled = false;
    let resolveFn!: (r: IntentResult) => void;
    const promise = new Promise<IntentResult>((r) => {
      resolveFn = r;
    });

    const tween = this.scene.tweens.add({
      targets: [proxyAlpha, proxyRadius],
      value: [0, 24],
      duration: durationMs,
      ease: DEFAULT_EASE,
      onUpdate: () => {
        g.clear();
        g.lineStyle(2, color, proxyAlpha.value);
        g.strokeCircle(0, 0, proxyRadius.value);
      },
      onComplete: () => {
        if (settled) return;
        settled = true;
        g.destroy();
        this.effectEntries.delete(effectId);
        resolveFn({ status: 'completed' });
      },
    });

    const cancel = () => {
      if (settled) return;
      settled = true;
      tween.stop();
      g.destroy();
      this.effectEntries.delete(effectId);
      resolveFn({ status: 'cancelled' });
    };

    this.effectEntries.set(effectId, { objects: [g], cancel });
    return { promise, cancel };
  }

  /**
   * 8-particle burst at (worldX, worldY). Particles scatter outward and fade.
   */
  particleBurstAt(
    effectId: string,
    worldX: number,
    worldY: number,
    durationMs: number,
    color: number,
  ): { promise: Promise<IntentResult>; cancel: () => void } {
    const existing = this.effectEntries.get(effectId);
    existing?.cancel();

    const PARTICLE_COUNT = 8;
    const graphics: Phaser.GameObjects.Graphics[] = [];
    const tweens: Phaser.Tweens.Tween[] = [];
    let completed = 0;
    let settled = false;
    let resolveFn!: (r: IntentResult) => void;
    const promise = new Promise<IntentResult>((r) => {
      resolveFn = r;
    });

    const cleanup = () => {
      for (const pg of graphics) pg.destroy();
      this.effectEntries.delete(effectId);
    };

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const dist = 16 + Math.random() * 8;
      const tx = worldX + Math.cos(angle) * dist;
      const ty = worldY + Math.sin(angle) * dist;

      const pg = this.scene.add.graphics();
      pg.fillStyle(color, 1);
      pg.fillCircle(0, 0, 2);
      pg.setPosition(worldX, worldY);
      pg.setDepth(EFFECT_DEPTH);
      graphics.push(pg);

      const tween = this.scene.tweens.add({
        targets: pg,
        x: tx,
        y: ty,
        alpha: 0,
        duration: durationMs,
        ease: PARTICLE_ALPHA_EASE,
        onComplete: () => {
          if (settled) return;
          completed++;
          if (completed === PARTICLE_COUNT) {
            settled = true;
            cleanup();
            resolveFn({ status: 'completed' });
          }
        },
      });
      tweens.push(tween);
    }

    const cancel = () => {
      if (settled) return;
      settled = true;
      for (const t of tweens) t.stop();
      cleanup();
      resolveFn({ status: 'cancelled' });
    };

    this.effectEntries.set(effectId, { objects: graphics, cancel });
    return { promise, cancel };
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  private buildDoorGraphics(floorIndex: number): DoorEntry {
    const originY = floorOriginY(floorIndex);
    const door = roomDoor('review');
    if (!door) {
      // Fallback: create an empty graphics
      const g = this.scene.add.graphics();
      const entry: DoorEntry = { graphics: g };
      this.doorEntries.set(floorIndex, entry);
      return entry;
    }
    const g = this.scene.add.graphics();
    g.fillStyle(PALETTE.reviewWall, 1);
    g.fillRect(door.x - DOOR_WIDTH / 2, originY + door.y, DOOR_WIDTH, TILE_SIZE);
    g.setDepth(35); // above room overlays
    const entry: DoorEntry = { graphics: g };
    this.doorEntries.set(floorIndex, entry);
    return entry;
  }

  private buildWallTintGraphics(floorIndex: number, roomId: RoomId): WallTintEntry {
    const originY = floorOriginY(floorIndex);
    const bounds = roomBounds(roomId);
    const g = this.scene.add.graphics();
    g.fillStyle(PALETTE.wall, 1);
    g.fillRect(bounds.x1, originY + bounds.y1, bounds.x2 - bounds.x1, bounds.y2 - bounds.y1);
    g.setAlpha(0);
    g.setDepth(52); // above standard overlays
    const key = `${floorIndex}:${roomId}`;
    const entry: WallTintEntry = { graphics: g };
    this.wallTintEntries.set(key, entry);
    return entry;
  }

  // ─── private ───────────────────────────────────────────────────────────────

  private buildFloor(floorIndex: number, project: OfficeProject): void {
    const originY = floorOriginY(floorIndex);
    const container = this.scene.add.container(0, 0);
    this.floorContainers.push(container);

    this.drawBase(container, originY);
    this.drawWalls(container, originY);
    this.drawRoomOverlays(container, originY);
    this.drawDoneShelf(container, originY);
    this.drawBanner(container, originY, project, floorIndex);
    this.drawRoomLabels(container, originY);
    this.drawDesks(container, originY, floorIndex);
    this.registerClickZones(container, originY, floorIndex);
  }

  private drawBase(container: Phaser.GameObjects.Container, originY: number): void {
    // Full-floor palette fallback under the tiled PNGs.
    const bg = this.scene.add.graphics();
    bg.fillStyle(PALETTE.floor, 1);
    bg.fillRect(0, originY, FLOOR_WORLD.width, FLOOR_WORLD.height);
    container.add(bg);

    // Warm-tone procedural room floor (matches canonical target's office
    // tone). PixelLab's floor_tile_02 was cool cyan brick — wrong palette.
    const warmFloorKey = TEXTURE_KEYS.floorRoomWarm;
    if (this.scene.textures.exists(warmFloorKey)) {
      const topBandH = TOP_BAND_Y.y2 - TOP_BAND_Y.y1 + 1;
      const topTiles = this.scene.add.tileSprite(
        0,
        originY + TOP_BAND_Y.y1,
        FLOOR_WORLD.width,
        topBandH,
        warmFloorKey,
      );
      topTiles.setOrigin(0, 0);
      container.add(topTiles);

      const bottomBandH = BOTTOM_BAND_Y.y2 - BOTTOM_BAND_Y.y1 + 1;
      const bottomTiles = this.scene.add.tileSprite(
        0,
        originY + BOTTOM_BAND_Y.y1,
        FLOOR_WORLD.width,
        bottomBandH,
        warmFloorKey,
      );
      bottomTiles.setOrigin(0, 0);
      container.add(bottomTiles);
    }

    // Middle corridor (between top band south wall and bottom band north wall).
    const corridorY = originY + CORRIDOR_Y.y1;
    const corridorH = CORRIDOR_Y.y2 - CORRIDOR_Y.y1 + 1;
    const corridor = this.scene.add.graphics();
    corridor.fillStyle(PALETTE.floorAlt, 1);
    corridor.fillRect(0, corridorY, FLOOR_WORLD.width, corridorH);
    container.add(corridor);

    if (this.scene.textures.exists('office:corridor_tile_02')) {
      const corridorTiles = this.scene.add.tileSprite(
        0,
        corridorY,
        FLOOR_WORLD.width,
        corridorH,
        'office:corridor_tile_02',
      );
      corridorTiles.setOrigin(0, 0);
      container.add(corridorTiles);
    }

    // Project banner (top of floor).
    const bannerBg = this.scene.add.graphics();
    bannerBg.fillStyle(PALETTE.wall, 1);
    bannerBg.fillRect(0, originY + ROW_BANNER_TOP, FLOOR_WORLD.width, TILE_SIZE * 3);
    container.add(bannerBg);
  }

  private drawWalls(container: Phaser.GameObjects.Container, originY: number): void {
    const W = FLOOR_WORLD.width;
    const walls = this.scene.add.graphics();
    walls.fillStyle(PALETTE.wall, 1);

    // Outer top + bottom horizontal walls.
    walls.fillRect(0, originY + ROW_TOP_WALL, W, TILE_SIZE);
    walls.fillRect(0, originY + ROW_BOTTOM_WALL, W, TILE_SIZE);

    // Top band ceiling (between banner and top band interior).
    walls.fillRect(0, originY + ROW_TOP_BAND_CEILING, W, TILE_SIZE);

    // Top band south wall — has door gaps facing the corridor.
    this.drawHorizontalWallWithDoors(
      walls,
      originY + ROW_TOP_BAND_SOUTH_WALL,
      W,
      this.topBandDoorXs(),
    );

    // Bottom band north wall — has door gaps facing the corridor.
    this.drawHorizontalWallWithDoors(
      walls,
      originY + ROW_BOTTOM_BAND_NORTH_WALL,
      W,
      this.bottomBandDoorXs(),
    );

    // Vertical inter-room walls — top band: y=ROW_TOP_BAND_CEILING..ROW_TOP_BAND_SOUTH_WALL+TILE_SIZE
    const topWallH = ROW_TOP_BAND_SOUTH_WALL + TILE_SIZE - ROW_TOP_BAND_CEILING;
    for (const wallX of TOP_INTER_ROOM_WALL_X) {
      walls.fillRect(wallX, originY + ROW_TOP_BAND_CEILING, TILE_SIZE, topWallH);
    }

    // Vertical inter-room walls — bottom band: y=ROW_BOTTOM_BAND_NORTH_WALL..ROW_BOTTOM_WALL+TILE_SIZE
    const bottomWallH = ROW_BOTTOM_WALL + TILE_SIZE - ROW_BOTTOM_BAND_NORTH_WALL;
    for (const wallX of BOTTOM_INTER_ROOM_WALL_X) {
      walls.fillRect(wallX, originY + ROW_BOTTOM_BAND_NORTH_WALL, TILE_SIZE, bottomWallH);
    }

    container.add(walls);
  }

  /** Top-band door x-positions. Slots (qa.input/output, library envelope)
   * are functional anchors only — they do NOT cut wall gaps. */
  private topBandDoorXs(): number[] {
    const xs: number[] = [];
    for (const id of TOP_BAND_ROOMS) {
      const door = roomDoor(id);
      if (door) xs.push(door.x);
    }
    return xs.sort((a, b) => a - b);
  }

  /** Bottom-band door x-positions. */
  private bottomBandDoorXs(): number[] {
    const xs: number[] = [];
    for (const id of BOTTOM_BAND_ROOMS) {
      const door = roomDoor(id);
      if (door) xs.push(door.x);
    }
    return xs.sort((a, b) => a - b);
  }

  /** Paint a horizontal wall row with 2-tile-wide gaps at each gapCenter. */
  private drawHorizontalWallWithDoors(
    g: Phaser.GameObjects.Graphics,
    wallY: number,
    totalWidth: number,
    gapCenters: number[],
  ): void {
    let cursor = 0;
    for (const cx of gapCenters) {
      const gapStart = cx - DOOR_HALF_WIDTH;
      const gapEnd = cx + DOOR_HALF_WIDTH;
      if (cursor < gapStart) {
        g.fillRect(cursor, wallY, gapStart - cursor, TILE_SIZE);
      }
      cursor = gapEnd;
    }
    if (cursor < totalWidth) {
      g.fillRect(cursor, wallY, totalWidth - cursor, TILE_SIZE);
    }
  }

  private drawRoomOverlays(container: Phaser.GameObjects.Container, originY: number): void {
    const overlays = this.scene.add.graphics();

    // QA chamber (top band) — frosted-cyan tint
    const qa = roomBounds('qa');
    overlays.fillStyle(PALETTE.qaWall, 0.45);
    overlays.fillRect(qa.x1, originY + qa.y1, qa.x2 - qa.x1, qa.y2 - qa.y1);

    // Review chamber (top band) — darker purple tint
    const review = roomBounds('review');
    overlays.fillStyle(PALETTE.reviewWall, 0.35);
    overlays.fillRect(review.x1, originY + review.y1, review.x2 - review.x1, review.y2 - review.y1);

    // Sealed Library (bottom band) — sealed-green-tinted opaque overlay + outline
    overlays.fillStyle(PALETTE.wall, 0.55);
    overlays.fillRect(
      LIBRARY_BOUNDS.x1,
      originY + LIBRARY_BOUNDS.y1,
      LIBRARY_BOUNDS.x2 - LIBRARY_BOUNDS.x1,
      LIBRARY_BOUNDS.y2 - LIBRARY_BOUNDS.y1,
    );
    overlays.lineStyle(1, PALETTE.reviewWall, 1);
    overlays.strokeRect(
      LIBRARY_BOUNDS.x1,
      originY + LIBRARY_BOUNDS.y1,
      LIBRARY_BOUNDS.x2 - LIBRARY_BOUNDS.x1,
      LIBRARY_BOUNDS.y2 - LIBRARY_BOUNDS.y1,
    );

    container.add(overlays);
  }

  private drawDoneShelf(container: Phaser.GameObjects.Container, originY: number): void {
    const done = roomBounds('done');
    const shelfY = done.y1 + 32;
    const shelfW = done.x2 - done.x1;
    const shelf = this.scene.add.graphics();
    shelf.fillStyle(PALETTE.desk, 1);
    shelf.fillRect(done.x1, originY + shelfY, shelfW, 8);
    shelf.fillStyle(PALETTE.deskTop, 1);
    shelf.fillRect(done.x1, originY + shelfY, shelfW, 2);
    container.add(shelf);
  }

  private drawBanner(
    container: Phaser.GameObjects.Container,
    originY: number,
    project: OfficeProject,
    floorIndex: number,
  ): void {
    // L-cell: Project Name
    const nameText = this.scene.add.text(
      FLOOR_PIXEL_WIDTH / 2,
      originY + ROW_BANNER_TOP + TILE_SIZE * 1.5,
      project.name,
      {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '10px',
        color: HUD_TINTS.hudCounterText,
        backgroundColor: '#2B2D42',
        padding: { left: 6, right: 6, top: 2, bottom: 2 },
      },
    );
    nameText.setOrigin(0.5, 0.5);
    container.add(nameText);

    // R-cell: Active Hero Ticket (initially hidden)
    const heroText = this.scene.add.text(
      BANNER_HERO_X,
      originY + ROW_BANNER_TOP + TILE_SIZE * 1.5,
      '',
      {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '9px',
        color: HUD_TINTS.hudBadgeText,
        backgroundColor: '#2B2D42',
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
      },
    );
    heroText.setOrigin(1, 0.5);
    heroText.setVisible(false);
    heroText.setDepth(60); // canvas-hud layer
    container.add(heroText);
    this.heroTicketTexts[floorIndex] = heroText;
  }

  private drawRoomLabels(container: Phaser.GameObjects.Container, originY: number): void {
    const style = {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '8px',
      color: HUD_TINTS.hudCounterText,
    };
    // Top-band labels: positioned just inside the top of each top-band room.
    const topLabelY = originY + TOP_BAND_Y.y1 + 8;
    const bottomLabelY = originY + BOTTOM_BAND_Y.y1 + 8;
    const labels: { x: number; y: number; text: string }[] = [];
    for (const id of ROOM_IDS) {
      const b = roomBounds(id);
      const cx = (b.x1 + b.x2) / 2;
      const y = roomBand(id) === 'top' ? topLabelY : bottomLabelY;
      labels.push({ x: cx, y, text: id.toUpperCase() });
    }
    for (const { x, y, text } of labels) {
      const t = this.scene.add.text(x, y, text, style);
      t.setOrigin(0.5, 0);
      container.add(t);
    }
  }

  private drawDesks(
    container: Phaser.GameObjects.Container,
    originY: number,
    floorIndex: number,
  ): void {
    for (const id of ROOM_IDS) {
      const anchors = roomDeskAnchors(id as RoomId);
      for (let i = 0; i < anchors.length; i++) {
        const { x, y } = anchors[i];
        const img = this.scene.add.image(x, originY + y, TEXTURE_KEYS.desk);
        img.setOrigin(0.5, 1);
        applyOfficeTextureDisplaySize(img, TEXTURE_KEYS.desk);
        container.add(img);

        const idle = this.scene.add.image(
          x,
          originY + y - TILE_SIZE * 2.5,
          TEXTURE_KEYS.indicatorCoffee,
        );
        idle.setOrigin(0.5, 1);
        applyOfficeTextureDisplaySize(idle, TEXTURE_KEYS.indicatorCoffee);
        idle.setData('kind', 'idle-indicator');
        idle.setData('floorIndex', floorIndex);
        idle.setData('deskKey', `${id}:${i}`);
        container.add(idle);
      }
    }
  }

  private registerClickZones(
    container: Phaser.GameObjects.Container,
    originY: number,
    floorIndex: number,
  ): void {
    for (const zone of allClickZones()) {
      const { x1, y1, x2, y2 } = zone.rect;
      const w = x2 - x1;
      const h = y2 - y1;
      const pz = this.scene.add.zone(x1 + w / 2, originY + y1 + h / 2, w, h);
      pz.setInteractive({ useHandCursor: false });
      pz.setData('zoneId', zone.id);
      pz.setData('floorIndex', floorIndex);
      this.clickZones.push(pz);
    }

    const dots = this.scene.add.graphics();
    dots.fillStyle(PALETTE.reviewWall, 0.4);
    for (const id of ROOM_IDS) {
      const qa = roomQueueAnchor(id as RoomId);
      if (qa) dots.fillCircle(qa.x, originY + qa.y, 3);
    }
    container.add(dots);
  }
}
