// Ambient persona layer — decorative geese that aren't tied to work items.
// Models the "idle goose coffee loop": a few geese hang around the Coffee
// room, bob in place, periodically wander to a random other room and come
// back for more coffee.
//
// Independent of PersonaLayer. Spawned per-floor when applyProjects fires.
// Pure visual layer — no events emitted, no clicks handled.

import type Phaser from 'phaser';
import { TILE_SIZE, floorOriginY } from '../../lib/layout';
import { ROOM_IDS, type RoomId, roomDeskAnchors } from '../../lib/rooms';
import { TEXTURE_KEYS, applyOfficeTextureDisplaySize } from '../textures';
import type { OfficeProject } from './types';

const AMBIENT_DEPTH = 28; // just under PersonaLayer (30)
const COFFEE_ROOM: RoomId = 'coffee';
const WALK_PIXELS_PER_MS = 0.18; // slower than personas — they're idling
const BOB_DISTANCE = 2;
const BOB_PERIOD_MS = 1400;
const SIT_DURATION_RANGE_MS: [number, number] = [4000, 9000];

interface AmbientEntry {
  id: string;
  floorIndex: number;
  body: Phaser.GameObjects.Image;
  mug: Phaser.GameObjects.Image | null;
  bobTween?: Phaser.Tweens.Tween;
  walkTween?: Phaser.Tweens.Tween;
  scheduledTimer?: Phaser.Time.TimerEvent;
  homeAnchor: { x: number; y: number };
  state: 'sitting-coffee' | 'walking-out' | 'sitting-away' | 'walking-home';
}

export class AmbientLayer {
  private readonly scene: Phaser.Scene;
  private projects: readonly OfficeProject[] = [];
  private entries: AmbientEntry[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  applyProjects(projects: readonly OfficeProject[]): void {
    this.projects = projects;
    this.destroyAll();
    for (let fi = 0; fi < projects.length; fi++) {
      this.spawnFloor(fi);
    }
  }

  destroyAll(): void {
    for (const e of this.entries) {
      e.bobTween?.stop();
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

    // Spawn one ambient goose per coffee anchor.
    for (let i = 0; i < coffeeAnchors.length; i++) {
      const anchor = coffeeAnchors[i];
      const wx = anchor.x;
      const wy = oy + anchor.y - TILE_SIZE; // sit on the floor near the desk
      const body = this.scene.add.image(wx, wy, gooseKey);
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
        state: 'sitting-coffee',
      };
      this.entries.push(entry);
      this.startBobbing(entry);
      this.scheduleWander(entry);
    }
  }

  /** Slow up-and-down bob — implies "alive" without big motion. */
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

  /** Schedule the next wander after a randomized sit duration. */
  private scheduleWander(entry: AmbientEntry): void {
    const [lo, hi] = SIT_DURATION_RANGE_MS;
    const delay = lo + Math.random() * (hi - lo);
    entry.scheduledTimer = this.scene.time.delayedCall(delay, () => this.wanderOut(entry));
  }

  /** Walk to a random non-coffee room desk on this floor, then come back. */
  private wanderOut(entry: AmbientEntry): void {
    const targets: { x: number; y: number }[] = [];
    const oy = floorOriginY(entry.floorIndex);
    for (const id of ROOM_IDS) {
      if (id === COFFEE_ROOM) continue;
      for (const a of roomDeskAnchors(id)) {
        targets.push({ x: a.x, y: oy + a.y - TILE_SIZE });
      }
    }
    if (targets.length === 0) {
      this.scheduleWander(entry);
      return;
    }
    const target = targets[Math.floor(Math.random() * targets.length)];
    this.stopBobbing(entry);
    entry.mug?.setVisible(false);
    entry.state = 'walking-out';
    this.walkTo(entry, target, () => {
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
    this.walkTo(entry, entry.homeAnchor, () => {
      entry.state = 'sitting-coffee';
      entry.mug?.setVisible(true);
      this.startBobbing(entry);
      this.scheduleWander(entry);
    });
  }

  /** Linear tween from current body position to target. Mug rides along. */
  private walkTo(entry: AmbientEntry, target: { x: number; y: number }, onDone: () => void): void {
    const dx = target.x - entry.body.x;
    const dy = target.y - entry.body.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.max(400, dist / WALK_PIXELS_PER_MS);
    entry.walkTween?.stop();
    const mugOffsetX = entry.mug != null ? entry.mug.x - entry.body.x : 0;
    const mugOffsetY = entry.mug != null ? entry.mug.y - entry.body.y : 0;
    entry.walkTween = this.scene.tweens.add({
      targets: entry.body,
      x: target.x,
      y: target.y,
      duration,
      ease: 'Linear',
      onUpdate: () => {
        if (entry.mug != null) {
          entry.mug.x = entry.body.x + mugOffsetX;
          entry.mug.y = entry.body.y + mugOffsetY;
        }
      },
      onComplete: () => {
        entry.walkTween = undefined;
        onDone();
      },
    });
  }
}
