// Owns all persona-level Phaser objects: sprite containers, walk tweens,
// indicator images, and desk-stacking within rooms.
//
// Reads:   lib/rooms.ts anchors (desk positions from roomDeskAnchors)
//          lib/layout.ts (floorOriginY, TILE_SIZE)
// Mutates: persona z-layers only (setDepth 30; codename labels at 35)
// Emits:   'desk-click' on the scene emitter when a persona container is clicked
//
// Does NOT import TicketLayer. Does NOT import from other layers.

import Phaser from 'phaser';
import type { PersonaPlacement } from '../../lib/agent-positions';
import { TILE_SIZE, floorOriginY } from '../../lib/layout';
import { facingFromMovement, pathLength, planWalk } from '../../lib/pathfinding';
import { type Priority, priorityTintColor, roomDeskAnchors } from '../../lib/rooms';
import type { IndicatorKind } from '../../lib/state-indicators';
import {
  HUD_TINTS,
  PALETTE,
  ROLE_TINTS,
  TEXTURE_KEYS,
  applyOfficeTextureDisplaySize,
  indicatorTextureKey,
  isGooseTextureKey,
  spriteTextureKeyForRole,
} from '../textures';

// Derive default role tint from room for spriteBase colouring
const ROOM_DEFAULT_ROLE: Record<string, string> = {
  triage: 'triager',
  investigation: 'investigator',
  dev: 'developer',
  qa: 'qa',
  review: 'reviewer',
  done: 'retrospector',
};
import type { DeskClickPayload, IntentResult, OfficeProject } from './types';

const WALK_PIXELS_PER_MS = 0.35;
const PERSONA_DEPTH = 30;

interface PersonaEntry {
  personaId: string;
  codename: string;
  projectSlug: string;
  workItemId: string;
  externalId: string;
  roomId: string | null;
  deskSlot: number;
  floorIndex: number;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  indicator: Phaser.GameObjects.Image;
  walkTween?: Phaser.Tweens.Tween | Phaser.Tweens.TweenChain;
  /** Resolve function for an in-flight intent walk; called by cancelWalk(). */
  walkResolve?: (result: IntentResult) => void;
  /** Codename label; only present when this persona is carrying the hero ticket. */
  label?: Phaser.GameObjects.Text;
}

interface PersonaLayerDeps {
  getProjects: () => readonly OfficeProject[];
}

export class PersonaLayer {
  private readonly scene: Phaser.Scene;
  private readonly emitter: Phaser.Events.EventEmitter;
  private readonly deps: PersonaLayerDeps;
  private personas = new Map<string, PersonaEntry>();

  constructor(scene: Phaser.Scene, emitter: Phaser.Events.EventEmitter, deps: PersonaLayerDeps) {
    this.scene = scene;
    this.emitter = emitter;
    this.deps = deps;
  }

  applyPlacements(placements: readonly PersonaPlacement[]): void {
    const seen = new Set<string>();

    for (const p of placements) {
      const floorIndex = this.floorIndexFor(p.projectSlug);
      if (floorIndex < 0) continue;

      const existing = this.personas.get(p.personaId);

      // Stay-put: roomId=null → freeze in place; just update indicator
      if (p.roomId == null) {
        if (existing == null) continue;
        seen.add(p.personaId);
        this.updateIndicator(existing, p);
        continue;
      }

      seen.add(p.personaId);

      if (existing == null) {
        this.spawn(p, floorIndex);
      } else if (
        existing.roomId !== p.roomId ||
        existing.deskSlot !== p.deskSlot ||
        existing.floorIndex !== floorIndex
      ) {
        this.walk(existing, p, floorIndex);
      } else {
        this.updateIndicator(existing, p);
      }
    }

    for (const [id, entry] of this.personas) {
      if (!seen.has(id)) {
        entry.label?.destroy();
        entry.container.destroy();
        this.personas.delete(id);
      }
    }

    this.restackAtSharedDesks();
  }

  dropAll(): void {
    for (const e of this.personas.values()) {
      e.label?.destroy();
      e.container.destroy();
    }
    this.personas.clear();
  }

  /**
   * Returns a set of strings keyed by "floorIndex:roomId:deskSlot"
   * for use by RoomLayer.refreshIdleDeskIndicators.
   */
  occupiedDeskKeys(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const e of this.personas.values()) {
      if (e.roomId != null) {
        keys.add(`${e.floorIndex}:${e.roomId}:${e.deskSlot}`);
      }
    }
    return keys;
  }

  /**
   * Returns the current world-space position of the persona container.
   * Used by TicketLayer to position carried tickets.
   */
  getCarrierPosition(personaId: string): { x: number; y: number } | null {
    const e = this.personas.get(personaId);
    if (e == null) return null;
    return { x: e.container.x, y: e.container.y };
  }

  /**
   * Returns the persona's container so TicketLayer can parent the ticket to
   * it for carry-follow (Phaser parent-child positioning, not per-frame copy).
   */
  getPersonaContainer(personaId: string): Phaser.GameObjects.Container | null {
    return this.personas.get(personaId)?.container ?? null;
  }

  /** Adds a codename label above the persona. Called by TicketLayer on hero promotion. */
  addCodenameLabel(personaId: string, priority?: Priority): void {
    const e = this.personas.get(personaId);
    if (e == null || e.label != null) return;
    const color = priority != null ? priorityTintColor(priority) : HUD_TINTS.hudBadgeText;
    // Parented to the container so it follows walk tweens and restack moves.
    const label = this.scene.add.text(0, -28, e.codename, {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '7px',
      color,
      backgroundColor: HUD_TINTS.hudPanelBgDark,
      padding: { left: 3, right: 3, top: 1, bottom: 1 },
    });
    label.setOrigin(0.5, 1);
    e.container.add(label);
    e.label = label;
  }

  /** Updates codename label colour for priority tinting; does not change the codename text. */
  setHeroCodename(personaId: string, priority: Priority): void {
    const e = this.personas.get(personaId);
    if (e == null) return;
    if (e.label != null) {
      e.label.setStyle({ color: priorityTintColor(priority) });
    } else {
      this.addCodenameLabel(personaId, priority);
    }
  }

  /** Removes the codename label. Called by TicketLayer on hero release. */
  removeCodenameLabel(personaId: string): void {
    const e = this.personas.get(personaId);
    if (e?.label == null) return;
    e.label.destroy();
    e.label = undefined;
  }

  // ─── Intent-layer primitives (called by ChoreographyPlayer intents) ──────────

  /**
   * Intent primitive: walk the persona to the given room + desk slot via the
   * path-planned route. Returns a promise that resolves when the walk completes
   * or is cancelled. Called by the `walkToRoom` intent module.
   */
  walkToRoom(personaId: string, destRoomId: string, deskSlot: number): Promise<IntentResult> {
    return new Promise<IntentResult>((resolve) => {
      const entry = this.personas.get(personaId);
      if (entry == null) {
        resolve({ status: 'failed', reason: 'persona-not-found' });
        return;
      }
      const floorIndex = entry.floorIndex;
      const toAnchor = this.deskWorldPos(destRoomId, deskSlot, floorIndex);
      if (toAnchor == null) {
        resolve({ status: 'failed', reason: 'invalid-destination' });
        return;
      }
      const toPos = { x: toAnchor.x, y: toAnchor.y - TILE_SIZE };
      const fromPos = { x: entry.container.x, y: entry.container.y };
      const segment = planWalk(fromPos, floorIndex, toPos, floorIndex);
      const targets = segment.waypoints.slice(1);

      const settle = (result: IntentResult) => {
        entry.walkResolve = undefined;
        resolve(result);
      };

      // Cancel any existing tween (including a previous intent walk).
      if (entry.walkResolve) {
        entry.walkResolve({ status: 'cancelled' });
      }
      if (entry.walkTween) {
        entry.walkTween.stop();
        entry.walkTween = undefined;
      }

      if (targets.length === 0) {
        entry.roomId = destRoomId;
        entry.deskSlot = deskSlot;
        settle({ status: 'completed' });
        return;
      }

      entry.walkResolve = settle;
      const totalLen = pathLength(segment.waypoints);
      const baseDuration = Math.max(150, totalLen / WALK_PIXELS_PER_MS);
      const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = targets.map((next, i) => {
        const prev = i === 0 ? fromPos : targets[i - 1];
        const len = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
        const dur = totalLen === 0 ? baseDuration : (len / totalLen) * baseDuration;
        return {
          targets: entry.container,
          x: next.x,
          y: next.y,
          duration: dur,
          ease: 'Linear',
          onStart: () => {
            entry.body.setFlipX(facingFromMovement(prev, next) === 'left');
          },
        };
      });

      entry.walkTween = this.scene.tweens.chain({
        tweens,
        onComplete: () => {
          entry.body.setFlipX(false);
          entry.roomId = destRoomId;
          entry.deskSlot = deskSlot;
          entry.walkTween = undefined;
          this.restackAtSharedDesks();
          settle({ status: 'completed' });
        },
      });
    });
  }

  /** Intent primitive: cancel an in-flight walkToRoom or seat tween. */
  cancelWalk(personaId: string): void {
    const entry = this.personas.get(personaId);
    if (entry == null) return;
    if (entry.walkTween) {
      entry.walkTween.stop();
      entry.walkTween = undefined;
    }
    if (entry.walkResolve) {
      entry.walkResolve({ status: 'cancelled' });
      entry.walkResolve = undefined;
    }
  }

  /**
   * Intent primitive: seat the persona at a specific desk slot within their
   * current room via a short tween. Called by the `attachToDesk` intent.
   */
  seat(personaId: string, deskSlot: number): Promise<IntentResult> {
    return new Promise<IntentResult>((resolve) => {
      const entry = this.personas.get(personaId);
      if (entry == null || entry.roomId == null) {
        resolve({ status: 'failed', reason: 'persona-not-found' });
        return;
      }
      const toAnchor = this.deskWorldPos(entry.roomId, deskSlot, entry.floorIndex);
      if (toAnchor == null) {
        resolve({ status: 'failed', reason: 'invalid-desk' });
        return;
      }
      const toPos = { x: toAnchor.x, y: toAnchor.y - TILE_SIZE };

      const settle = (result: IntentResult) => {
        entry.walkResolve = undefined;
        resolve(result);
      };

      if (entry.walkResolve) entry.walkResolve({ status: 'cancelled' });
      if (entry.walkTween) {
        entry.walkTween.stop();
        entry.walkTween = undefined;
      }

      entry.walkResolve = settle;
      const tween = this.scene.tweens.add({
        targets: entry.container,
        x: toPos.x,
        y: toPos.y,
        duration: 300,
        ease: 'Linear',
        onComplete: () => {
          entry.deskSlot = deskSlot;
          entry.walkTween = undefined;
          this.restackAtSharedDesks();
          settle({ status: 'completed' });
        },
      });
      entry.walkTween = tween as unknown as Phaser.Tweens.Tween;
    });
  }

  /** Intent primitive: swap the indicator glyph (null → idle/coffee). */
  setIndicator(personaId: string, glyph: IndicatorKind | null): void {
    const entry = this.personas.get(personaId);
    if (entry == null) return;
    const textureKey = indicatorTextureKey(glyph ?? 'coffee');
    entry.indicator.setTexture(textureKey);
    applyOfficeTextureDisplaySize(entry.indicator, textureKey);
  }

  /**
   * Phase 5 primitive: pause a persona's walk tween and dim the sprite.
   * Used by the ambient-suppression path to visually freeze personas
   * while a critical cinematic runs.
   */
  freezePersona(personaId: string): void {
    const entry = this.personas.get(personaId);
    if (entry == null) return;
    if (entry.walkTween) {
      (entry.walkTween as Phaser.Tweens.Tween).pause?.();
    }
    entry.body.setAlpha(0.5);
  }

  /**
   * Phase 5 primitive: resume a previously frozen persona.
   */
  unfreezePersona(personaId: string): void {
    const entry = this.personas.get(personaId);
    if (entry == null) return;
    if (entry.walkTween) {
      (entry.walkTween as Phaser.Tweens.Tween).resume?.();
    }
    entry.body.setAlpha(1);
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private floorIndexFor(slug: string): number {
    return this.deps.getProjects().findIndex((p) => p.slug === slug);
  }

  private deskWorldPos(
    roomId: string,
    deskSlot: number,
    floorIndex: number,
  ): { x: number; y: number } | null {
    const anchors = roomDeskAnchors(roomId as Parameters<typeof roomDeskAnchors>[0]);
    const anchor = anchors[deskSlot];
    if (anchor == null) return null;
    const oy = floorOriginY(floorIndex);
    return { x: anchor.x, y: oy + anchor.y };
  }

  private spawn(p: PersonaPlacement, floorIndex: number): void {
    if (p.roomId == null) return;
    const pos = this.deskWorldPos(p.roomId, p.deskSlot, floorIndex);
    if (pos == null) return;

    const container = this.scene.add.container(pos.x, pos.y - TILE_SIZE);
    container.setDepth(PERSONA_DEPTH);

    const role = p.roomId != null ? (ROOM_DEFAULT_ROLE[p.roomId] ?? 'developer') : 'developer';
    const bodyKey = spriteTextureKeyForRole(role, this.scene);
    const body = this.scene.add.image(0, 0, bodyKey);
    body.setOrigin(0.5, 1);
    applyOfficeTextureDisplaySize(body, bodyKey);
    if (!isGooseTextureKey(bodyKey)) {
      body.setTint(ROLE_TINTS[role] ?? PALETTE.amber);
    }
    container.add(body);

    const indicator = this.scene.add.image(0, -TILE_SIZE - 4, indicatorTextureKey(p.indicator));
    indicator.setOrigin(0.5, 1);
    applyOfficeTextureDisplaySize(indicator, indicatorTextureKey(p.indicator));
    container.add(indicator);

    container.setSize(TILE_SIZE, TILE_SIZE * 2);
    container.setData('workItemId', p.workItemId);
    container.setData('externalId', p.externalId);
    container.setData('projectSlug', p.projectSlug);
    container.setData('title', p.title ?? '');
    container.setData('personaId', p.personaId);

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
          projectSlug: container.getData('projectSlug') as string,
          workItemId: container.getData('workItemId') as string,
          externalId: container.getData('externalId') as string,
          title: (container.getData('title') as string) || undefined,
        } satisfies DeskClickPayload);
        evt?.stopPropagation();
      },
    );

    this.personas.set(p.personaId, {
      personaId: p.personaId,
      codename: p.codename,
      projectSlug: p.projectSlug,
      workItemId: p.workItemId,
      externalId: p.externalId,
      roomId: p.roomId,
      deskSlot: p.deskSlot,
      floorIndex,
      container,
      body,
      indicator,
    });
  }

  private updateIndicator(entry: PersonaEntry, p: PersonaPlacement): void {
    const textureKey = indicatorTextureKey(p.indicator);
    entry.indicator.setTexture(textureKey);
    applyOfficeTextureDisplaySize(entry.indicator, textureKey);
    entry.container.setData('workItemId', p.workItemId);
    entry.container.setData('externalId', p.externalId);
    entry.container.setData('title', p.title ?? '');
  }

  private walk(entry: PersonaEntry, p: PersonaPlacement, toFloorIndex: number): void {
    if (p.roomId == null) {
      this.updateIndicator(entry, p);
      return;
    }

    const fromPos = { x: entry.container.x, y: entry.container.y };
    const toAnchor = this.deskWorldPos(p.roomId, p.deskSlot, toFloorIndex);
    if (toAnchor == null) {
      this.updateIndicator(entry, p);
      return;
    }
    const toPos = { x: toAnchor.x, y: toAnchor.y - TILE_SIZE };

    const segment = planWalk(fromPos, entry.floorIndex, toPos, toFloorIndex);
    const totalLen = pathLength(segment.waypoints);
    const baseDuration = Math.max(150, totalLen / WALK_PIXELS_PER_MS);
    const targets = segment.waypoints.slice(1);
    if (targets.length === 0) {
      this.updateIndicator(entry, p);
      return;
    }

    // Cancel any in-flight intent walk promise before overriding the tween.
    if (entry.walkResolve) {
      entry.walkResolve({ status: 'cancelled' });
      entry.walkResolve = undefined;
    }
    if (entry.walkTween) entry.walkTween.stop();

    const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
    for (let i = 0; i < targets.length; i++) {
      const prev = i === 0 ? fromPos : targets[i - 1];
      const next = targets[i];
      const len = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
      const dur = totalLen === 0 ? baseDuration : (len / totalLen) * baseDuration;
      tweens.push({
        targets: entry.container,
        x: next.x,
        y: next.y,
        duration: dur,
        ease: 'Linear',
        onStart: () => {
          entry.body.setFlipX(facingFromMovement(prev, next) === 'left');
        },
      });
    }

    entry.walkTween = this.scene.tweens.chain({
      tweens,
      onComplete: () => {
        entry.body.setFlipX(false);
        entry.roomId = p.roomId;
        entry.deskSlot = p.deskSlot;
        entry.floorIndex = toFloorIndex;
        if (p.roomId != null) {
          const newRole = ROOM_DEFAULT_ROLE[p.roomId] ?? 'developer';
          entry.body.setTint(ROLE_TINTS[newRole] ?? PALETTE.amber);
        }
        this.updateIndicator(entry, p);
        this.restackAtSharedDesks();
      },
    });
  }

  private restackAtSharedDesks(): void {
    const groups = new Map<string, PersonaEntry[]>();
    for (const e of this.personas.values()) {
      const key = `${e.floorIndex}:${e.roomId}:${e.deskSlot}`;
      const arr = groups.get(key);
      if (arr) arr.push(e);
      else groups.set(key, [e]);
    }

    for (const [key, group] of groups) {
      if (group.length <= 1) continue;
      const parts = key.split(':');
      const floorIdx = Number(parts[0]);
      const roomId = parts[1];
      const deskSlot = Number(parts[2]);
      const anchors = roomDeskAnchors(roomId as Parameters<typeof roomDeskAnchors>[0]);
      const anchor = anchors[deskSlot];
      if (anchor == null) continue;
      const oy = floorOriginY(floorIdx);
      const baseX = anchor.x;

      group.sort((a, b) => a.externalId.localeCompare(b.externalId));
      const span = (group.length - 1) * TILE_SIZE;
      const startX = baseX - span / 2;
      for (let i = 0; i < group.length; i++) {
        const e = group[i];
        if (e.walkTween && (e.walkTween as Phaser.Tweens.Tween).isPlaying?.()) continue;
        e.container.x = startX + i * TILE_SIZE;
        e.container.y = oy + anchor.y - TILE_SIZE;
      }
    }
  }
}
