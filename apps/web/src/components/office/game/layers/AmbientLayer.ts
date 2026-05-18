// Ambient persona layer — decorative geese that aren't tied to work items.
// Models the "idle goose coffee loop": a few geese hang around the Coffee
// room, bob in place, periodically wander to a random other room via the
// proper corridor route, and come back for more coffee.
//
// Independent of PersonaLayer. Spawned per-floor when applyProjects fires.
// Pure visual layer — no events emitted, no clicks handled.
//
// Phase 9c: corridor routing — geese exit their current room via its door,
// walk along the corridor lane, enter the destination via that room's
// door. No more diagonal cuts through walls. Walking animation = vertical
// bob + horizontal flip based on direction.

import type Phaser from 'phaser';
import { TILE_SIZE, floorOriginY } from '../../lib/layout';
import { facingFromMovement } from '../../lib/pathfinding';
import { CORRIDOR_WALK_Y, ROOM_IDS, type RoomId, roomDeskAnchors, roomDoor } from '../../lib/rooms';
import { TEXTURE_KEYS, applyOfficeTextureDisplaySize } from '../textures';
import type { OfficeProject } from './types';

const AMBIENT_DEPTH = 28; // just under PersonaLayer (30)
const COFFEE_ROOM: RoomId = 'coffee';
const WALK_PIXELS_PER_MS = 0.16; // slower than personas — they're idling
const BOB_DISTANCE = 2;
const BOB_PERIOD_MS = 1400;
const WALK_BOB_AMPLITUDE = 1;
const WALK_BOB_PERIOD_MS = 280;
const SIT_DURATION_RANGE_MS: [number, number] = [4000, 9000];

interface Point {
  x: number;
  y: number;
}

interface AmbientEntry {
  id: string;
  floorIndex: number;
  body: Phaser.GameObjects.Sprite;
  mug: Phaser.GameObjects.Image | null;
  bobTween?: Phaser.Tweens.Tween;
  walkBobTween?: Phaser.Tweens.Tween;
  walkTween?: Phaser.Tweens.Tween;
  scheduledTimer?: Phaser.Time.TimerEvent;
  homeAnchor: Point;
  currentRoomId: RoomId;
  state: 'sitting-coffee' | 'walking-out' | 'sitting-away' | 'walking-home';
}

export class AmbientLayer {
  private readonly scene: Phaser.Scene;
  private entries: AmbientEntry[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  applyProjects(projects: readonly OfficeProject[]): void {
    this.destroyAll();
    for (let fi = 0; fi < projects.length; fi++) {
      this.spawnFloor(fi);
    }
  }

  destroyAll(): void {
    for (const e of this.entries) {
      e.bobTween?.stop();
      e.walkBobTween?.stop();
      e.walkTween?.stop();
      e.scheduledTimer?.remove();
      e.body.destroy();
      e.mug?.destroy();
    }
    this.entries = [];
  }

  // ─── private ───────────────────────────────────────────────────────────────

  private spawnFloor(floorIndex: number): void {
    const oy = floorOriginY(floorIndex);
    const coffeeAnchors = roomDeskAnchors(COFFEE_ROOM);
    if (coffeeAnchors.length === 0) return;
    const gooseKey = this.scene.textures.exists('office:goose_idle')
      ? 'office:goose_idle'
      : TEXTURE_KEYS.spriteBase;
    const mugKey = TEXTURE_KEYS.indicatorCoffee;
    const mugLoaded = this.scene.textures.exists(mugKey);

    for (let i = 0; i < coffeeAnchors.length; i++) {
      const anchor = coffeeAnchors[i];
      const wx = anchor.x;
      const wy = oy + anchor.y - TILE_SIZE;
      const body = this.scene.add.sprite(wx, wy, gooseKey);
      body.setOrigin(0.5, 1);
      applyOfficeTextureDisplaySize(body, gooseKey);
      body.setDepth(AMBIENT_DEPTH);
      let mug: Phaser.GameObjects.Image | null = null;
      if (mugLoaded) {
        mug = this.scene.add.image(wx + 8, wy - 18, mugKey);
        mug.setOrigin(0.5, 1);
        applyOfficeTextureDisplaySize(mug, mugKey);
        mug.setDepth(AMBIENT_DEPTH + 1);
      }
      const entry: AmbientEntry = {
        id: `ambient-${floorIndex}-${i}`,
        floorIndex,
        body,
        mug,
        homeAnchor: { x: wx, y: wy },
        currentRoomId: COFFEE_ROOM,
        state: 'sitting-coffee',
      };
      this.entries.push(entry);
      this.startBobbing(entry);
      this.scheduleWander(entry);
    }
  }

  /** Slow up-and-down bob — implies "alive" while sitting. */
  private startBobbing(entry: AmbientEntry): void {
    entry.bobTween?.stop();
    entry.bobTween = this.scene.tweens.add({
      targets: [entry.body, entry.mug].filter((t): t is Phaser.GameObjects.Image => t != null),
      y: `+=${BOB_DISTANCE}`,
      duration: BOB_PERIOD_MS / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private stopBobbing(entry: AmbientEntry): void {
    entry.bobTween?.stop();
    entry.bobTween = undefined;
  }

  /** Quick step-bob while walking — gives the goose a "stepping" feel. */
  private startWalkBob(entry: AmbientEntry): void {
    entry.walkBobTween?.stop();
    entry.walkBobTween = this.scene.tweens.add({
      targets: entry.body,
      y: `+=${WALK_BOB_AMPLITUDE}`,
      duration: WALK_BOB_PERIOD_MS / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private stopWalkBob(entry: AmbientEntry): void {
    entry.walkBobTween?.stop();
    entry.walkBobTween = undefined;
  }

  private scheduleWander(entry: AmbientEntry): void {
    const [lo, hi] = SIT_DURATION_RANGE_MS;
    const delay = lo + Math.random() * (hi - lo);
    entry.scheduledTimer = this.scene.time.delayedCall(delay, () => this.wanderOut(entry));
  }

  private wanderOut(entry: AmbientEntry): void {
    const candidates: { roomId: RoomId; pos: Point }[] = [];
    const oy = floorOriginY(entry.floorIndex);
    for (const id of ROOM_IDS) {
      if (id === COFFEE_ROOM) continue;
      for (const a of roomDeskAnchors(id)) {
        candidates.push({ roomId: id, pos: { x: a.x, y: oy + a.y - TILE_SIZE } });
      }
    }
    if (candidates.length === 0) {
      this.scheduleWander(entry);
      return;
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    this.stopBobbing(entry);
    entry.mug?.setVisible(false);
    entry.state = 'walking-out';
    const waypoints = this.corridorRoute(
      { x: entry.body.x, y: entry.body.y },
      entry.currentRoomId,
      target.pos,
      target.roomId,
      entry.floorIndex,
    );
    this.walkAlong(entry, waypoints, () => {
      entry.currentRoomId = target.roomId;
      entry.state = 'sitting-away';
      this.startBobbing(entry);
      const [lo, hi] = SIT_DURATION_RANGE_MS;
      const stayMs = lo + Math.random() * (hi - lo);
      entry.scheduledTimer = this.scene.time.delayedCall(stayMs, () => this.walkHome(entry));
    });
  }

  private walkHome(entry: AmbientEntry): void {
    this.stopBobbing(entry);
    entry.state = 'walking-home';
    const waypoints = this.corridorRoute(
      { x: entry.body.x, y: entry.body.y },
      entry.currentRoomId,
      entry.homeAnchor,
      COFFEE_ROOM,
      entry.floorIndex,
    );
    this.walkAlong(entry, waypoints, () => {
      entry.currentRoomId = COFFEE_ROOM;
      entry.state = 'sitting-coffee';
      entry.mug?.setVisible(true);
      // Restore mug position relative to body
      if (entry.mug != null) {
        entry.mug.x = entry.body.x + 8;
        entry.mug.y = entry.body.y - 18;
      }
      this.startBobbing(entry);
      this.scheduleWander(entry);
    });
  }

  /** Build waypoints that exit `startRoom` via its door, traverse the
   * corridor walking lane, enter `targetRoom` via its door, and arrive
   * at targetPos. Both rooms must be on the same floor. */
  private corridorRoute(
    startPos: Point,
    startRoomId: RoomId,
    targetPos: Point,
    targetRoomId: RoomId,
    floorIndex: number,
  ): Point[] {
    const oy = floorOriginY(floorIndex);
    const corridorY = oy + CORRIDOR_WALK_Y;
    const startDoor = roomDoor(startRoomId);
    const targetDoor = roomDoor(targetRoomId);
    const waypoints: Point[] = [];

    // 1. From start position to room's door x (horizontal in room)
    if (startDoor && startPos.x !== startDoor.x) {
      waypoints.push({ x: startDoor.x, y: startPos.y });
    }
    // 2. From room door down/up to corridor lane
    if (startDoor) {
      waypoints.push({ x: startDoor.x, y: corridorY });
    }
    // 3. Along the corridor lane to the target room's door x
    if (targetDoor && (!startDoor || startDoor.x !== targetDoor.x)) {
      waypoints.push({ x: targetDoor.x, y: corridorY });
    }
    // 4. From corridor up/down into the target room (at door y)
    if (targetDoor) {
      waypoints.push({ x: targetDoor.x, y: targetPos.y });
    }
    // 5. Arrive at target position
    waypoints.push(targetPos);
    return waypoints;
  }

  /** Sequence tweens through each waypoint pair. Each segment animates
   * body x/y; mug rides along. Body horizontally flips based on dx.
   * Step-bob + walk-spritesheet animation runs across the whole walk. */
  private walkAlong(entry: AmbientEntry, waypoints: Point[], onDone: () => void): void {
    if (waypoints.length === 0) {
      onDone();
      return;
    }
    this.startWalkBob(entry);
    // Switch to walking spritesheet + play looped 2-frame walk.
    if (this.scene.anims.exists('goose-walk')) {
      entry.body.play('goose-walk', true);
      applyOfficeTextureDisplaySize(
        entry.body as unknown as Phaser.GameObjects.Image,
        'office:goose-walk',
      );
    }
    const gooseKey = this.scene.textures.exists('office:goose_idle')
      ? 'office:goose_idle'
      : TEXTURE_KEYS.spriteBase;
    let idx = 0;
    const next = () => {
      if (idx >= waypoints.length) {
        this.stopWalkBob(entry);
        // Stop walk anim, return to idle texture. Reset flipX so the idle
        // pose displays in its natural orientation (the idle and walk
        // sheets do not share a default-facing direction).
        entry.body.stop();
        entry.body.setFlipX(false);
        entry.body.setTexture(gooseKey);
        applyOfficeTextureDisplaySize(entry.body as unknown as Phaser.GameObjects.Image, gooseKey);
        onDone();
        return;
      }
      const target = waypoints[idx];
      idx++;
      const dx = target.x - entry.body.x;
      const dy = target.y - entry.body.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        next();
        return;
      }
      // The walk spritesheet birds face RIGHT by default — verified from the
      // asset pixel data (orange beak on the right edge of each 16-wide
      // frame). So flip when moving LEFT, leave unflipped when moving RIGHT.
      const facing = facingFromMovement({ x: entry.body.x, y: entry.body.y }, target);
      if (facing === 'left') entry.body.setFlipX(true);
      else if (facing === 'right') entry.body.setFlipX(false);
      const duration = Math.max(220, dist / WALK_PIXELS_PER_MS);
      const mugOffsetX = entry.mug != null ? entry.mug.x - entry.body.x : 0;
      const mugOffsetY = entry.mug != null ? entry.mug.y - entry.body.y : 0;
      entry.walkTween?.stop();
      entry.walkTween = this.scene.tweens.add({
        targets: entry.body,
        x: target.x,
        y: target.y,
        duration,
        ease: 'Linear',
        onUpdate: () => {
          if (entry.mug?.visible) {
            entry.mug.x = entry.body.x + mugOffsetX;
            entry.mug.y = entry.body.y + mugOffsetY;
          }
        },
        onComplete: () => {
          entry.walkTween = undefined;
          next();
        },
      });
    };
    next();
  }
}
