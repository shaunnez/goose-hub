// The single Phaser scene that draws the entire Office view: stacked floors,
// project banners, desks, sprites, indicators, walks, and stair clicks.
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
import { type AgentPlacement, OFFICE_ROLES, busyRoles } from '../lib/agent-positions';
import {
  FLOOR_PIXEL_HEIGHT,
  FLOOR_PIXEL_WIDTH,
  TILE_SIZE,
  deskPositions,
  floorCenterY,
  floorOriginY,
  stairsPosition,
  totalWorldHeight,
} from '../lib/layout';
import { facingFromMovement, pathLength, planWalk } from '../lib/pathfinding';
import { queueVerifiedPngAssets } from './asset-loader';

/** Verified PNG assets to queue in preload (probed by the React mount). */
interface VerifiedAsset {
  key: string;
  url: string;
}
import {
  TEXTURE_KEYS,
  ensureOfficeTextures,
  indicatorTextureKey,
  spriteTextureKeyForRole,
} from './textures';

export interface OfficeProject {
  slug: string;
  name: string;
  color?: string;
}

export interface DeskClickPayload {
  projectSlug: string;
  workItemId: string;
  externalId: string;
  title?: string;
}

export interface FloorChangePayload {
  floorIndex: number;
  projectSlug: string;
  projectName: string;
}

const WALK_PIXELS_PER_MS = 0.35;

interface SpriteEntry {
  workItemId: string;
  externalId: string;
  projectSlug: string;
  role: string;
  floorIndex: number;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  indicator: Phaser.GameObjects.Image;
  /** Active tween for an in-flight walk, if any. */
  walkTween?: Phaser.Tweens.Tween | Phaser.Tweens.TweenChain;
}

export class OfficeScene extends Phaser.Scene {
  private readonly emitter = new Phaser.Events.EventEmitter();
  private projects: OfficeProject[] = [];
  private placements: AgentPlacement[] = [];
  private sprites = new Map<string, SpriteEntry>();
  private deskClickZones = new Map<string, Phaser.GameObjects.Zone>();
  private floorContainers: Phaser.GameObjects.Container[] = [];
  private currentFloorIndex = 0;
  private resizeListener?: () => void;
  private verifiedAssets: VerifiedAsset[] = [];

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
    // Background fill so the scene reads as one continuous building.
    this.cameras.main.setBackgroundColor('#0d0a13');

    ensureOfficeTextures(this);

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
    for (const c of this.floorContainers) c.destroy();
    this.floorContainers = [];
    for (const z of this.deskClickZones.values()) z.destroy();
    this.deskClickZones.clear();
    // Existing sprites lose their floor binding — drop them; the next
    // applyPlacements call will recreate as needed.
    for (const s of this.sprites.values()) s.container.destroy();
    this.sprites.clear();

    for (let i = 0; i < this.projects.length; i++) {
      this.buildFloor(i, this.projects[i]);
    }

    const worldH = Math.max(totalWorldHeight(this.projects.length), this.scale.height);
    this.cameras.main.setBounds(0, 0, FLOOR_PIXEL_WIDTH, worldH);
    if (this.currentFloorIndex >= this.projects.length) this.currentFloorIndex = 0;
    this.snapCameraToFloor(this.currentFloorIndex);
  }

  /**
   * Drop / add / move sprites to match the new placement list. Walks any
   * sprite whose role changed; preserves sprites whose role didn't change.
   *
   * Stay-put placements (`p.role == null`, e.g. `needs-human` /
   * `gate-pending`): if a sprite already exists, keep it at its current desk
   * and only swap the indicator. If no sprite exists yet (rare — first ever
   * sighting in a blocked state), drop the placement; we have no prior desk
   * to anchor it to.
   */
  applyPlacements(placements: readonly AgentPlacement[]): void {
    this.placements = placements.slice();
    const seen = new Set<string>();
    for (const p of placements) {
      const floorIndex = this.floorIndexFor(p.projectSlug);
      if (floorIndex < 0) continue;
      const existing = this.sprites.get(p.spriteId);
      if (p.role == null) {
        // Stay-put: only meaningful if a sprite already exists.
        if (existing == null) continue;
        seen.add(p.spriteId);
        this.updateIndicator(existing, p);
        continue;
      }
      seen.add(p.spriteId);
      if (existing == null) {
        this.spawnSprite(p, floorIndex);
      } else if (existing.role !== p.role || existing.floorIndex !== floorIndex) {
        this.walkSprite(existing, p, floorIndex);
      } else {
        this.updateIndicator(existing, p);
      }
    }
    // Despawn sprites no longer in the placement list (including those that
    // entered a terminal state — done / archived / rejected — and were
    // dropped by `placementsFromItems`).
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        s.container.destroy();
        this.sprites.delete(id);
      }
    }
    // Reposition any same-desk sprites so they're individually clickable.
    this.restackSpritesAtSharedDesks();
    // Refresh idle indicators on empty desks.
    this.refreshIdleDeskIndicators();
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

  private buildFloor(floorIndex: number, project: OfficeProject): void {
    const originY = floorOriginY(floorIndex);
    const container = this.add.container(0, 0);
    this.floorContainers.push(container);

    // Floor tiles — alternate two shades for a checkered feel.
    for (let ty = 0; ty < FLOOR_PIXEL_HEIGHT / TILE_SIZE; ty++) {
      for (let tx = 0; tx < FLOOR_PIXEL_WIDTH / TILE_SIZE; tx++) {
        const key = (tx + ty) % 2 === 0 ? TEXTURE_KEYS.floorTile : TEXTURE_KEYS.floorTileAlt;
        const tile = this.add.image(tx * TILE_SIZE, originY + ty * TILE_SIZE, key);
        tile.setOrigin(0, 0);
        container.add(tile);
      }
    }

    // Top wall row.
    for (let tx = 0; tx < FLOOR_PIXEL_WIDTH / TILE_SIZE; tx++) {
      const w = this.add.image(tx * TILE_SIZE, originY, TEXTURE_KEYS.wallTile);
      w.setOrigin(0, 0);
      container.add(w);
    }

    // Project banner (HTML-rendered text since Phaser bitmap font would need
    // its own font asset — pixel-text via a system font @ small size is fine).
    const banner = this.add.text(
      FLOOR_PIXEL_WIDTH / 2,
      originY + TILE_SIZE / 2,
      `Floor ${floorIndex + 1} — ${project.name}`,
      {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '10px',
        color: '#c7b8ff',
        backgroundColor: '#1a1622',
        padding: { left: 6, right: 6, top: 2, bottom: 2 },
      },
    );
    banner.setOrigin(0.5, 0.5);
    container.add(banner);

    // Desks — one per role, with a click zone that receives sprite clicks.
    const desks = deskPositions(floorIndex);
    for (const desk of desks) {
      const img = this.add.image(desk.x, desk.y, TEXTURE_KEYS.desk);
      img.setOrigin(0.5, 1);
      container.add(img);
      // Coffee idle indicator placeholder, replaced by spawnSprite when busy.
      const idle = this.add.image(desk.x, desk.y - TILE_SIZE * 2.5, TEXTURE_KEYS.indicatorCoffee);
      idle.setOrigin(0.5, 1);
      idle.setData('role', desk.role);
      idle.setData('floorIndex', floorIndex);
      idle.setData('kind', 'idle-indicator');
      container.add(idle);
      // Click zone covering the desk + sprite area.
      const zone = this.add.zone(desk.x, desk.y - TILE_SIZE, TILE_SIZE * 3, TILE_SIZE * 4);
      zone.setOrigin(0.5, 1);
      zone.setInteractive({ useHandCursor: true });
      zone.setData('role', desk.role);
      zone.setData('floorIndex', floorIndex);
      zone.on('pointerdown', () => this.handleDeskClick(floorIndex, desk.role));
      this.deskClickZones.set(`${floorIndex}:${desk.role}`, zone);
      container.add(zone);
    }

    // Stairs sprite — clickable; navigates +1 floor. (Down-arrow on bottom
    // floor and up-arrow on top floor keyboard shortcut already clamps.)
    const stairs = stairsPosition(floorIndex);
    const stairsImg = this.add.image(stairs.x, stairs.y, TEXTURE_KEYS.stairs);
    stairsImg.setOrigin(0.5, 0);
    stairsImg.setInteractive({ useHandCursor: true });
    stairsImg.setData('floorIndex', floorIndex);
    stairsImg.on('pointerdown', () => {
      // Click goes to next floor (down) on most floors; on the bottom, goes up.
      const nextDelta = floorIndex === this.projects.length - 1 ? -1 : +1;
      this.navigateFloor(nextDelta);
    });
    container.add(stairsImg);
  }

  private spawnSprite(p: AgentPlacement, floorIndex: number): void {
    if (p.role == null) return;
    const desks = deskPositions(floorIndex);
    const target = desks.find((d) => d.role === p.role);
    if (target == null) return;
    const container = this.add.container(target.x, target.y - TILE_SIZE);
    const body = this.add.image(0, 0, spriteTextureKeyForRole(p.role));
    body.setOrigin(0.5, 1);
    container.add(body);
    const indicator = this.add.image(0, -TILE_SIZE - 4, indicatorTextureKey(p.indicator));
    indicator.setOrigin(0.5, 1);
    container.add(indicator);
    container.setSize(TILE_SIZE, TILE_SIZE * 2);
    container.setData('workItemId', p.workItemId);
    container.setData('externalId', p.externalId);
    container.setData('projectSlug', p.projectSlug);
    container.setData('title', p.title ?? '');
    container.setData('role', p.role);
    container.setData('spriteId', p.spriteId);
    // Per-sprite click → emits with this exact work item, so multiple sprites
    // sharing a desk are each independently reachable from the click-through
    // panel (M17.05 + Codex P2 review).
    container.setInteractive(
      new Phaser.Geom.Rectangle(-TILE_SIZE / 2, -TILE_SIZE * 2, TILE_SIZE, TILE_SIZE * 2),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _x: number,
        _y: number,
        evt: Phaser.Types.Input.EventData,
      ) => {
        this.emitter.emit('desk-click', {
          projectSlug: p.projectSlug,
          workItemId: container.getData('workItemId') as string,
          externalId: container.getData('externalId') as string,
          title: (container.getData('title') as string) || undefined,
        } satisfies DeskClickPayload);
        // Prevent the underlying desk zone from firing a second click for
        // the same pointerdown.
        evt?.stopPropagation();
      },
    );
    this.sprites.set(p.spriteId, {
      workItemId: p.workItemId,
      externalId: p.externalId,
      projectSlug: p.projectSlug,
      role: p.role,
      floorIndex,
      container,
      body,
      indicator,
    });
  }

  private updateIndicator(entry: SpriteEntry, p: AgentPlacement): void {
    entry.indicator.setTexture(indicatorTextureKey(p.indicator));
    entry.container.setData('workItemId', p.workItemId);
    entry.container.setData('externalId', p.externalId);
    entry.container.setData('title', p.title ?? '');
  }

  private walkSprite(entry: SpriteEntry, p: AgentPlacement, toFloorIndex: number): void {
    if (p.role == null) {
      // Stay-put — caller (`applyPlacements`) already handled this via
      // `updateIndicator`, but be defensive in case of future callers.
      this.updateIndicator(entry, p);
      return;
    }
    const fromDesks = deskPositions(entry.floorIndex);
    const toDesks = deskPositions(toFloorIndex);
    const fromDesk = fromDesks.find((d) => d.role === entry.role);
    const toDesk = toDesks.find((d) => d.role === p.role);
    if (fromDesk == null || toDesk == null) {
      // Bad mapping — snap to destination.
      this.updateIndicator(entry, p);
      return;
    }
    const fromPoint = { x: fromDesk.x, y: fromDesk.y - TILE_SIZE };
    const toPoint = { x: toDesk.x, y: toDesk.y - TILE_SIZE };
    const segment = planWalk(fromPoint, entry.floorIndex, toPoint, toFloorIndex);
    const totalLen = pathLength(segment.waypoints);
    const baseDuration = Math.max(150, totalLen / WALK_PIXELS_PER_MS);
    // Build a chained tween across waypoints.
    const targets = segment.waypoints.slice(1);
    if (targets.length === 0) {
      this.updateIndicator(entry, p);
      return;
    }
    if (entry.walkTween) entry.walkTween.stop();

    let accum = 0;
    const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
    for (let i = 0; i < targets.length; i++) {
      const prev = i === 0 ? fromPoint : targets[i - 1];
      const next = targets[i];
      const len = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
      const dur = totalLen === 0 ? baseDuration : (len / totalLen) * baseDuration;
      accum += dur;
      tweens.push({
        targets: entry.container,
        x: next.x,
        y: next.y,
        duration: dur,
        ease: 'Linear',
        onStart: () => {
          const facing = facingFromMovement(prev, next);
          entry.body.setFlipX(facing === 'left');
        },
      });
    }
    entry.walkTween = this.tweens.chain({
      tweens,
      onComplete: () => {
        entry.body.setFlipX(false);
        if (p.role != null) entry.role = p.role;
        entry.floorIndex = toFloorIndex;
        this.updateIndicator(entry, p);
        this.restackSpritesAtSharedDesks();
      },
    });
    void accum;
  }

  private refreshIdleDeskIndicators(): void {
    // Source of truth for "this desk has someone at it" is the live sprite
    // map (which reflects walk-in-progress positions), not the placement
    // list. That way stay-put blocked sprites still hide their desk's idle
    // coffee even though their placement carries a null role.
    const occupied = new Set<string>();
    for (const s of this.sprites.values()) {
      occupied.add(`${s.floorIndex}:${s.role}`);
    }
    for (const c of this.floorContainers) {
      const children = c.list as Phaser.GameObjects.GameObject[];
      for (const child of children) {
        if ((child as Phaser.GameObjects.Image).getData?.('kind') !== 'idle-indicator') continue;
        const key = `${(child as Phaser.GameObjects.Image).getData('floorIndex')}:${(
          child as Phaser.GameObjects.Image
        ).getData('role')}`;
        (child as Phaser.GameObjects.Image).setVisible(!occupied.has(key));
      }
    }
    void busyRoles;
    void OFFICE_ROLES;
  }

  /**
   * Spread sprites that share a floor+role across a small horizontal range so
   * each one is individually clickable. With ≤1 sprite per desk this is a
   * no-op; with N sprites, they're laid out across ±(N-1)/2 × OFFSET pixels.
   */
  private restackSpritesAtSharedDesks(): void {
    const groups = new Map<string, SpriteEntry[]>();
    for (const s of this.sprites.values()) {
      const key = `${s.floorIndex}:${s.role}`;
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }
    const OFFSET = TILE_SIZE; // one tile between stacked sprites
    for (const [key, group] of groups) {
      if (group.length <= 1) continue;
      const [floorIdxStr, role] = key.split(':');
      const floorIdx = Number(floorIdxStr);
      const desks = deskPositions(floorIdx);
      const desk = desks.find((d) => d.role === role);
      if (desk == null) continue;
      // Sort for deterministic placement.
      group.sort((a, b) => a.externalId.localeCompare(b.externalId));
      const baseX = desk.x;
      const span = (group.length - 1) * OFFSET;
      const startX = baseX - span / 2;
      for (let i = 0; i < group.length; i++) {
        const s = group[i];
        // Skip mid-walk: that tween owns the position.
        if (s.walkTween && (s.walkTween as Phaser.Tweens.Tween).isPlaying?.()) continue;
        s.container.x = startX + i * OFFSET;
      }
    }
  }

  /**
   * Fallback handler for clicks on the desk zone (vs. directly on a sprite).
   * Per-sprite clicks are wired in `spawnSprite` and emit precise payloads;
   * this only fires when the click landed on a desk with no sprite covering
   * it (or the user clicked a thin sliver around the sprite). Matches the
   * first placement at the desk — adequate for "open something at this desk"
   * UX since the per-sprite path already lets users pick a specific issue
   * when multiple share a desk.
   */
  private handleDeskClick(floorIndex: number, role: string): void {
    const project = this.projects[floorIndex];
    if (project == null) return;
    const placement = this.placements.find(
      (p) => p.projectSlug === project.slug && p.role === role,
    );
    if (placement == null) return;
    this.emitter.emit('desk-click', {
      projectSlug: project.slug,
      workItemId: placement.workItemId,
      externalId: placement.externalId,
      title: placement.title,
    } satisfies DeskClickPayload);
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
