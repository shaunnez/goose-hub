// Owns all sprite-level Phaser objects: sprite containers, walk tweens,
// indicator images, and desk-stacking. Knows nothing about floor geometry
// beyond what it gets via the getProjects callback.
//
// Public contract:
//   applyPlacements(placements)  — diff + spawn/walk/despawn sprites
//   dropAll()                    — destroy every sprite (called from applyProjects)
//   occupiedDeskKeys()           — set of "floorIndex:role" strings; fed to
//                                  FloorLayer.refreshIdleDeskIndicators by the scene

import Phaser from 'phaser';
import type { AgentPlacement } from '../../lib/agent-positions';
import { TILE_SIZE, deskPositions } from '../../lib/layout';
import { facingFromMovement, pathLength, planWalk } from '../../lib/pathfinding';
import { indicatorTextureKey, spriteTextureKeyForRole } from '../textures';
import type { DeskClickPayload, OfficeProject } from './types';

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

interface SpriteLayerDeps {
  getProjects: () => readonly OfficeProject[];
}

export class SpriteLayer {
  private readonly scene: Phaser.Scene;
  private readonly emitter: Phaser.Events.EventEmitter;
  private readonly deps: SpriteLayerDeps;
  private sprites = new Map<string, SpriteEntry>();
  private placements: AgentPlacement[] = [];

  constructor(scene: Phaser.Scene, emitter: Phaser.Events.EventEmitter, deps: SpriteLayerDeps) {
    this.scene = scene;
    this.emitter = emitter;
    this.deps = deps;
  }

  applyPlacements(placements: readonly AgentPlacement[]): void {
    this.placements = placements.slice();
    const seen = new Set<string>();
    for (const p of placements) {
      const floorIndex = this.floorIndexFor(p.projectSlug);
      if (floorIndex < 0) continue;
      const existing = this.sprites.get(p.spriteId);
      if (p.role == null) {
        if (existing == null) continue;
        seen.add(p.spriteId);
        this.updateIndicator(existing, p);
        continue;
      }
      seen.add(p.spriteId);
      if (existing == null) {
        this.spawn(p, floorIndex);
      } else if (existing.role !== p.role || existing.floorIndex !== floorIndex) {
        this.walk(existing, p, floorIndex);
      } else {
        this.updateIndicator(existing, p);
      }
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        s.container.destroy();
        this.sprites.delete(id);
      }
    }
    this.restackAtSharedDesks();
    // Note: FloorLayer.refreshIdleDeskIndicators is called by OfficeScene
    // after this returns, using this.occupiedDeskKeys().
  }

  dropAll(): void {
    for (const s of this.sprites.values()) s.container.destroy();
    this.sprites.clear();
  }

  occupiedDeskKeys(): ReadonlySet<string> {
    const occupied = new Set<string>();
    for (const s of this.sprites.values()) {
      occupied.add(`${s.floorIndex}:${s.role}`);
    }
    return occupied;
  }

  getPlacements(): readonly AgentPlacement[] {
    return this.placements;
  }

  private floorIndexFor(slug: string): number {
    return this.deps.getProjects().findIndex((p) => p.slug === slug);
  }

  private spawn(p: AgentPlacement, floorIndex: number): void {
    if (p.role == null) return;
    const desks = deskPositions(floorIndex);
    const target = desks.find((d) => d.role === p.role);
    if (target == null) return;
    const container = this.scene.add.container(target.x, target.y - TILE_SIZE);
    const body = this.scene.add.image(0, 0, spriteTextureKeyForRole(p.role));
    body.setOrigin(0.5, 1);
    container.add(body);
    const indicator = this.scene.add.image(0, -TILE_SIZE - 4, indicatorTextureKey(p.indicator));
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

  private walk(entry: SpriteEntry, p: AgentPlacement, toFloorIndex: number): void {
    if (p.role == null) {
      this.updateIndicator(entry, p);
      return;
    }
    const fromDesks = deskPositions(entry.floorIndex);
    const toDesks = deskPositions(toFloorIndex);
    const fromDesk = fromDesks.find((d) => d.role === entry.role);
    const toDesk = toDesks.find((d) => d.role === p.role);
    if (fromDesk == null || toDesk == null) {
      this.updateIndicator(entry, p);
      return;
    }
    const fromPoint = { x: fromDesk.x, y: fromDesk.y - TILE_SIZE };
    const toPoint = { x: toDesk.x, y: toDesk.y - TILE_SIZE };
    const segment = planWalk(fromPoint, entry.floorIndex, toPoint, toFloorIndex);
    const totalLen = pathLength(segment.waypoints);
    const baseDuration = Math.max(150, totalLen / WALK_PIXELS_PER_MS);
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
    entry.walkTween = this.scene.tweens.chain({
      tweens,
      onComplete: () => {
        entry.body.setFlipX(false);
        if (p.role != null) entry.role = p.role;
        entry.floorIndex = toFloorIndex;
        this.updateIndicator(entry, p);
        this.restackAtSharedDesks();
      },
    });
    void accum;
  }

  private restackAtSharedDesks(): void {
    const groups = new Map<string, SpriteEntry[]>();
    for (const s of this.sprites.values()) {
      const key = `${s.floorIndex}:${s.role}`;
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }
    const OFFSET = TILE_SIZE;
    for (const [key, group] of groups) {
      if (group.length <= 1) continue;
      const [floorIdxStr, role] = key.split(':');
      const floorIdx = Number(floorIdxStr);
      const desks = deskPositions(floorIdx);
      const desk = desks.find((d) => d.role === role);
      if (desk == null) continue;
      group.sort((a, b) => a.externalId.localeCompare(b.externalId));
      const baseX = desk.x;
      const span = (group.length - 1) * OFFSET;
      const startX = baseX - span / 2;
      for (let i = 0; i < group.length; i++) {
        const s = group[i];
        if (s.walkTween && (s.walkTween as Phaser.Tweens.Tween).isPlaying?.()) continue;
        s.container.x = startX + i * OFFSET;
      }
    }
  }
}
