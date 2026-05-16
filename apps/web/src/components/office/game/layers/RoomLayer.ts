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

import Phaser from 'phaser';
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
import {
  BRASS_TINTS,
  HUD_TINTS,
  PALETTE,
  TEXTURE_KEYS,
  applyOfficeTextureDisplaySize,
  roomDeskTextureKey,
} from '../textures';
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
// Phase 9: outer top wall + banner + top-band ceiling rows were removed
// (the new DOM TopHudBar covers that area). Remaining row constants:
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
    this.drawRoomBackWalls(container, originY);
    this.drawRoomBackWallProps(container, originY);
    this.drawRoomOverlays(container, originY);
    this.drawDoneShelf(container, originY);
    this.drawBanner(container, originY, project, floorIndex);
    this.drawRoomLabels(container, originY);
    this.drawDesks(container, originY, floorIndex);
    this.drawRoomLamps(container, originY);
    this.drawTopBandDoors(container, originY);
    this.drawBottomBandDoors(container, originY);
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

    const corridorKey = TEXTURE_KEYS.corridorWarm;
    if (this.scene.textures.exists(corridorKey)) {
      const corridorTiles = this.scene.add.tileSprite(
        0,
        corridorY,
        FLOOR_WORLD.width,
        corridorH,
        corridorKey,
      );
      corridorTiles.setOrigin(0, 0);
      container.add(corridorTiles);
    }

    // Phase 9: project banner removed from canvas. Name lives in the
    // DOM TopHudBar; banner area is left blank for the HUD to overlay.
  }

  private drawWalls(container: Phaser.GameObjects.Container, originY: number): void {
    const W = FLOOR_WORLD.width;
    const walls = this.scene.add.graphics();
    walls.fillStyle(PALETTE.wall, 1);

    // Outer bottom horizontal wall (top wall removed in Phase 9 — the new
    // top HUD covers that area cleanly).
    walls.fillRect(0, originY + ROW_BOTTOM_WALL, W, TILE_SIZE);

    // Left exterior wall column — spans both bands. Phase 9: added so the
    // leftmost rooms (Dev, Backlog) read as enclosed instead of running
    // off-frame.
    walls.fillRect(0, originY + TOP_BAND_Y.y1, TILE_SIZE, BOTTOM_BAND_Y.y2 - TOP_BAND_Y.y1 + 1);

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

    // Vertical inter-room walls — top band
    const topWallH = ROW_TOP_BAND_SOUTH_WALL + TILE_SIZE - TOP_BAND_Y.y1;
    for (const wallX of TOP_INTER_ROOM_WALL_X) {
      walls.fillRect(wallX, originY + TOP_BAND_Y.y1, TILE_SIZE, topWallH);
    }

    // Vertical inter-room walls — bottom band
    const bottomWallH = ROW_BOTTOM_WALL + TILE_SIZE - ROW_BOTTOM_BAND_NORTH_WALL;
    for (const wallX of BOTTOM_INTER_ROOM_WALL_X) {
      walls.fillRect(wallX, originY + ROW_BOTTOM_BAND_NORTH_WALL, TILE_SIZE, bottomWallH);
    }

    container.add(walls);

    // Stone texture overlay on the bottom outer wall, vertical inter-room
    // walls, the new left exterior wall, and the doored band walls.
    this.drawBrickWalls(container, originY);
  }

  /** Stone-block texture overlay on every wall surface. Phase 9 dropped
   * the outer top wall + top-band ceiling rows (the new HUD covers that
   * area). Adds the new left exterior wall column. */
  private drawBrickWalls(container: Phaser.GameObjects.Container, originY: number): void {
    const brickKey = TEXTURE_KEYS.stoneWall;
    if (!this.scene.textures.exists(brickKey)) return;
    const W = FLOOR_WORLD.width;
    // Outer bottom horizontal wall only (top + ceiling removed in Phase 9)
    const bottomBrick = this.scene.add.tileSprite(
      0,
      originY + ROW_BOTTOM_WALL,
      W,
      TILE_SIZE,
      brickKey,
    );
    bottomBrick.setOrigin(0, 0);
    container.add(bottomBrick);

    // Left exterior wall column (full height of both bands)
    const leftBrick = this.scene.add.tileSprite(
      0,
      originY + TOP_BAND_Y.y1,
      TILE_SIZE,
      BOTTOM_BAND_Y.y2 - TOP_BAND_Y.y1 + 1,
      brickKey,
    );
    leftBrick.setOrigin(0, 0);
    container.add(leftBrick);

    // Vertical inter-room walls — both bands.
    const topWallH = ROW_TOP_BAND_SOUTH_WALL + TILE_SIZE - TOP_BAND_Y.y1;
    for (const wallX of TOP_INTER_ROOM_WALL_X) {
      const brick = this.scene.add.tileSprite(
        wallX,
        originY + TOP_BAND_Y.y1,
        TILE_SIZE,
        topWallH,
        brickKey,
      );
      brick.setOrigin(0, 0);
      container.add(brick);
    }
    const bottomWallH = ROW_BOTTOM_WALL + TILE_SIZE - ROW_BOTTOM_BAND_NORTH_WALL;
    for (const wallX of BOTTOM_INTER_ROOM_WALL_X) {
      const brick = this.scene.add.tileSprite(
        wallX,
        originY + ROW_BOTTOM_BAND_NORTH_WALL,
        TILE_SIZE,
        bottomWallH,
        brickKey,
      );
      brick.setOrigin(0, 0);
      container.add(brick);
    }

    // Top-band south wall and bottom-band north wall — segmented brick
    // TileSprites between door gaps.
    this.drawSegmentedBrickRow(
      container,
      brickKey,
      originY + ROW_TOP_BAND_SOUTH_WALL,
      this.topBandDoorXs(),
    );
    this.drawSegmentedBrickRow(
      container,
      brickKey,
      originY + ROW_BOTTOM_BAND_NORTH_WALL,
      this.bottomBandDoorXs(),
    );

    // (Phase 2) Removed special vertical wall PNGs (frosted-glass cyan +
    // sealed-green). They read as floor strips, not walls. QA / Library
    // identity now lives in their back-wall props (Phase 3).
  }

  /** Stamp a special vertical wall PNG (frosted/sealed) over a brick
   * wall position. No-op if the texture isn't loaded. */
  private drawSpecialVerticalWall(
    container: Phaser.GameObjects.Container,
    textureKey: string,
    wallX: number,
    wallWorldY: number,
    wallHeight: number,
  ): void {
    if (!this.scene.textures.exists(textureKey)) return;
    const special = this.scene.add.tileSprite(wallX, wallWorldY, TILE_SIZE, wallHeight, textureKey);
    special.setOrigin(0, 0);
    container.add(special);
  }

  /** Paint brick TileSprites along a wall row, skipping 2-tile-wide door
   * gaps at each gapCenter. */
  private drawSegmentedBrickRow(
    container: Phaser.GameObjects.Container,
    brickKey: string,
    wallWorldY: number,
    gapCenters: number[],
  ): void {
    const W = FLOOR_WORLD.width;
    let cursor = 0;
    for (const cx of gapCenters) {
      const gapStart = cx - DOOR_HALF_WIDTH;
      const gapEnd = cx + DOOR_HALF_WIDTH;
      if (cursor < gapStart) {
        const seg = this.scene.add.tileSprite(
          cursor,
          wallWorldY,
          gapStart - cursor,
          TILE_SIZE,
          brickKey,
        );
        seg.setOrigin(0, 0);
        container.add(seg);
      }
      cursor = gapEnd;
    }
    if (cursor < W) {
      const seg = this.scene.add.tileSprite(cursor, wallWorldY, W - cursor, TILE_SIZE, brickKey);
      seg.setOrigin(0, 0);
      container.add(seg);
    }
  }

  /** Per-room back wall — full 6 tiles (96 px) of warm-charcoal dark
   * stone. Phase 9 removed the ceiling-pipe row and the brick lintel
   * row; the wall is now a single uniform surface where the lamp, sign
   * and props mount. Recession shadow at the floor seam keeps the
   * depth read. */
  private drawRoomBackWalls(container: Phaser.GameObjects.Container, originY: number): void {
    const TOTAL_WALL_HEIGHT = TILE_SIZE * 6;
    const darkKey = TEXTURE_KEYS.darkWall;
    const darkLoaded = this.scene.textures.exists(darkKey);

    for (const id of ROOM_IDS) {
      const b = roomBounds(id);
      const w = b.x2 - b.x1;
      const x = b.x1;
      const y0 = originY + b.y1;

      // Solid dark base in case the dark-wall texture doesn't load
      const bg = this.scene.add.graphics();
      bg.fillStyle(PALETTE.wall, 1);
      bg.fillRect(x, y0, w, TOTAL_WALL_HEIGHT);
      bg.setDepth(2);
      container.add(bg);

      if (darkLoaded) {
        const dark = this.scene.add.tileSprite(x, y0, w, TOTAL_WALL_HEIGHT, darkKey);
        dark.setOrigin(0, 0);
        dark.setDepth(2);
        container.add(dark);
      }

      // Wall-bottom darkening — pools shadow at the wall/floor seam,
      // giving the back wall a sense of recession.
      const bottomShadow = this.scene.add.graphics();
      for (let i = 0; i < 14; i++) {
        const alpha = 0.05 + (i / 14) * 0.3;
        bottomShadow.fillStyle(0x0, alpha);
        bottomShadow.fillRect(x, y0 + TOTAL_WALL_HEIGHT - 14 + i, w, 1);
      }
      bottomShadow.setDepth(2);
      container.add(bottomShadow);

      // 2-px shadow seam at the wall-floor join.
      const seam = this.scene.add.graphics();
      seam.fillStyle(0x0, 0.75);
      seam.fillRect(x, y0 + TOTAL_WALL_HEIGHT, w, 2);
      seam.setDepth(2);
      container.add(seam);
    }
  }

  /** Mounts thematic prop PNGs onto each room's back wall. Each entry is
   * (textureKey, normalizedX) pairs where normalizedX 0..1 spans the
   * room's width. Props anchor at (0.5, 1) so they sit *on* the floor
   * seam, hanging "down" from the back wall band. No-ops when a PNG is
   * not loaded. */
  private drawRoomBackWallProps(container: Phaser.GameObjects.Container, originY: number): void {
    const props: Record<RoomId, Array<{ key: string; nx: number }>> = {
      dev: [
        { key: 'office:dev_monitor_dual', nx: 0.18 },
        { key: 'office:dev_monitor_dual', nx: 0.45 },
        { key: 'office:dev_monitor_dual', nx: 0.72 },
      ],
      qa: [
        { key: 'office:qa_warning_light', nx: 0.18 },
        { key: 'office:qa_warning_light', nx: 0.4 },
        { key: 'office:qa_warning_light', nx: 0.62 },
        { key: 'office:qa_warning_light', nx: 0.84 },
      ],
      review: [{ key: 'office:quality_score_gauge', nx: 0.5 }],
      retro: [],
      done: [
        { key: 'office:merge_trophy_small', nx: 0.3 },
        { key: 'office:merge_trophy_small', nx: 0.7 },
      ],
      archive: [
        { key: 'office:archive_drawer', nx: 0.3 },
        { key: 'office:archive_drawer', nx: 0.7 },
      ],
      backlog: [
        { key: 'office:paperwork_stack', nx: 0.2 },
        { key: 'office:paperwork_stack', nx: 0.5 },
        { key: 'office:paperwork_stack', nx: 0.8 },
      ],
      triage: [{ key: 'office:intake_board', nx: 0.5 }],
      investigation: [{ key: 'office:investigation_map_board', nx: 0.5 }],
      library: [
        { key: 'office:bookshelf_small', nx: 0.2 },
        { key: 'office:bookshelf_large', nx: 0.5 },
        { key: 'office:bookshelf_small', nx: 0.8 },
      ],
      coffee: [{ key: 'office:goose_coffee_sign', nx: 0.5 }],
    };
    // Props anchor at the floor seam (back wall is now 6 tiles tall —
    // see drawRoomBackWalls) and extend upward into the wall.
    const wallRowsHeight = TILE_SIZE * 6;
    for (const id of ROOM_IDS) {
      const list = props[id];
      if (list.length === 0) continue;
      const b = roomBounds(id);
      const w = b.x2 - b.x1;
      const seamY = originY + b.y1 + wallRowsHeight;
      for (const { key, nx } of list) {
        if (!this.scene.textures.exists(key)) continue;
        const img = this.scene.add.image(b.x1 + Math.round(w * nx), seamY, key);
        img.setOrigin(0.5, 1);
        applyOfficeTextureDisplaySize(img, key);
        img.setDepth(3); // above back wall, below desks
        container.add(img);
      }
    }
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

    // QA chamber (top band) — subtle frosted-cyan tint
    const qa = roomBounds('qa');
    overlays.fillStyle(PALETTE.qaWall, 0.1);
    overlays.fillRect(qa.x1, originY + qa.y1, qa.x2 - qa.x1, qa.y2 - qa.y1);

    // Review chamber (top band) — subtle purple tint
    const review = roomBounds('review');
    overlays.fillStyle(PALETTE.reviewWall, 0.08);
    overlays.fillRect(review.x1, originY + review.y1, review.x2 - review.x1, review.y2 - review.y1);

    // Sealed Library (bottom band) — subtle tint, no outline
    overlays.fillStyle(PALETTE.reviewWall, 0.08);
    overlays.fillRect(
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
    _project: OfficeProject,
    floorIndex: number,
  ): void {
    // Project name now lives in the DOM TopHudBar (Phase 9). The banner
    // function is retained only to register the per-floor hero-ticket
    // text (used as a Phaser-side fallback when the DOM HUD is hidden).

    // R-cell: Active Hero Ticket (initially hidden). Sits at the top of
    // the floor since the banner background was removed — Phaser-side
    // fallback only; the real hero card lives in the DOM BottomHudBar.
    const heroText = this.scene.add.text(BANNER_HERO_X, originY + TILE_SIZE * 2.5, '', {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '9px',
      color: HUD_TINTS.hudBadgeText,
      backgroundColor: '#2B2D42',
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    });
    heroText.setOrigin(1, 0.5);
    heroText.setVisible(false);
    heroText.setDepth(60); // canvas-hud layer
    container.add(heroText);
    this.heroTicketTexts[floorIndex] = heroText;
  }

  /** Brass-framed room name plates. Sit centered on each room's back
   * wall band, framed by a darker rounded rectangle with a 1-px brass
   * border so they read as etched signage rather than a console label. */
  private drawRoomLabels(container: Phaser.GameObjects.Container, originY: number): void {
    const PLATE_BG = BRASS_TINTS.brassPlateBg;
    const PLATE_BORDER_BRASS = BRASS_TINTS.brassEdge;
    const PLATE_BORDER_DARK = BRASS_TINTS.brassDark;
    const TEXT_FILL = '#fde58a';
    const TEXT_STROKE = '#3a2410';

    for (const id of ROOM_IDS) {
      const b = roomBounds(id);
      const cx = (b.x1 + b.x2) / 2;
      // Sign sits in the upper portion of the (now 6-tile-tall) dark wall,
      // just below the lintel — "high on the wall" like real signage.
      const signY = originY + b.y1 + TILE_SIZE * 2 + 12;
      const text = id.toUpperCase();

      // Text first so we can size the plate to it
      const t = this.scene.add.text(cx, signY, text, {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '9px',
        color: TEXT_FILL,
        stroke: TEXT_STROKE,
        strokeThickness: 2,
      });
      t.setOrigin(0.5, 0.5);
      t.setDepth(5);

      // Brass plate frame sized to the text + 6 px padding
      const padX = 8;
      const padY = 3;
      const plateW = Math.round(t.width) + padX * 2;
      const plateH = Math.round(t.height) + padY * 2;
      const plateX = cx - plateW / 2;
      const plateY = signY - plateH / 2;
      const plate = this.scene.add.graphics();
      plate.setDepth(4);
      // Outer brass border
      plate.fillStyle(PLATE_BORDER_BRASS, 1);
      plate.fillRect(plateX, plateY, plateW, plateH);
      // Dark inset
      plate.fillStyle(PLATE_BORDER_DARK, 1);
      plate.fillRect(plateX + 1, plateY + 1, plateW - 2, plateH - 2);
      // Plate face
      plate.fillStyle(PLATE_BG, 1);
      plate.fillRect(plateX + 2, plateY + 2, plateW - 4, plateH - 4);
      container.add(plate);
      container.add(t);
    }
  }

  /** Door frames at each top-band room's south-wall door gap. Anchors at
   * (door.x, top-band south-wall row), origin (0.5, 1) so the door's foot
   * sits on the corridor edge. */
  private drawTopBandDoors(container: Phaser.GameObjects.Container, originY: number): void {
    const doorKey = TEXTURE_KEYS.doorFrame;
    if (!this.scene.textures.exists(doorKey)) return;
    for (const id of TOP_BAND_ROOMS) {
      const door = roomDoor(id);
      if (!door) continue;
      const img = this.scene.add.image(door.x, originY + door.y + TILE_SIZE, doorKey);
      img.setOrigin(0.5, 1);
      applyOfficeTextureDisplaySize(img, doorKey);
      img.setDepth(4);
      container.add(img);
    }
  }

  /** Flat doors at each bottom-band room's north-wall door gap. Unlike
   * the top-band doorFrame which protrudes, the flatDoor sits flush
   * inside the door gap (32 wide × 16 tall). Origin (0.5, 0) — anchored
   * at the top of the door row. */
  private drawBottomBandDoors(container: Phaser.GameObjects.Container, originY: number): void {
    const doorKey = TEXTURE_KEYS.flatDoor;
    if (!this.scene.textures.exists(doorKey)) return;
    for (const id of BOTTOM_BAND_ROOMS) {
      const door = roomDoor(id);
      if (!door) continue;
      const img = this.scene.add.image(door.x, originY + door.y, doorKey);
      img.setOrigin(0.5, 0);
      applyOfficeTextureDisplaySize(img, doorKey);
      img.setDepth(4);
      container.add(img);
    }
  }

  /** Pendant lamp(s) hung against each room's back wall. A 2-px brass
   * chain runs from the ceiling-pipes row down into the wall; the
   * pendant lamp sprite sits at the chain's bottom, lit by a warm halo
   * pooled around the bulb. Wall is 6 tiles tall (96 px) so chains are
   * long — the bulb hangs ~2/3 down the wall. */
  private drawRoomLamps(container: Phaser.GameObjects.Container, originY: number): void {
    const lampKey = TEXTURE_KEYS.pendantLamp;
    if (!this.scene.textures.exists(lampKey)) return;
    const haloKey = 'office:glow_soft';
    const haloLoaded = this.scene.textures.exists(haloKey);
    // Phase 9: ceiling pipes / lintel removed — chain hangs from the very
    // top of the back wall down to the lamp top in the lower-middle area.
    const chainTopOffset = 0;
    const lampTopOffset = TILE_SIZE * 3 + 4; // y1 + 52 — bulb ends near y1+80
    for (const id of ROOM_IDS) {
      const b = roomBounds(id);
      const width = b.x2 - b.x1;
      const count = Math.max(1, Math.min(3, Math.round(width / 96)));
      for (let i = 0; i < count; i++) {
        const t = (i + 1) / (count + 1);
        const x = b.x1 + width * t;
        // Brass chain rectangle from ceiling pipes to lamp top
        const chain = this.scene.add.graphics();
        chain.fillStyle(BRASS_TINTS.brassDark, 1);
        chain.fillRect(x - 1, originY + b.y1 + chainTopOffset, 2, lampTopOffset - chainTopOffset);
        chain.setDepth(3);
        container.add(chain);
        // Warm halo on the wall behind the bulb
        if (haloLoaded) {
          const halo = this.scene.add.image(x, originY + b.y1 + lampTopOffset + 24, haloKey);
          halo.setOrigin(0.5, 0.5);
          applyOfficeTextureDisplaySize(halo, haloKey);
          halo.setAlpha(0.28);
          halo.setBlendMode(Phaser.BlendModes.NORMAL);
          halo.setDepth(3);
          container.add(halo);
        }
        const lamp = this.scene.add.image(x, originY + b.y1 + lampTopOffset, lampKey);
        lamp.setOrigin(0.5, 0);
        applyOfficeTextureDisplaySize(lamp, lampKey);
        lamp.setDepth(4);
        container.add(lamp);
      }
    }
  }

  private drawDesks(
    container: Phaser.GameObjects.Container,
    originY: number,
    floorIndex: number,
  ): void {
    for (const id of ROOM_IDS) {
      const anchors = roomDeskAnchors(id as RoomId);
      const deskKey = roomDeskTextureKey(id, this.scene);
      for (let i = 0; i < anchors.length; i++) {
        const { x, y } = anchors[i];
        const img = this.scene.add.image(x, originY + y, deskKey);
        img.setOrigin(0.5, 1);
        applyOfficeTextureDisplaySize(img, deskKey);
        container.add(img);

        // Idle indicator (coffee mug) is hidden by default — Phase 5 will
        // surface it dynamically as part of the goose coffee-loop behaviour.
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
        idle.setVisible(false);
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
