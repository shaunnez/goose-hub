// Owns all ticket-level Phaser objects: ticket sprite containers, carry offsets,
// queue stacks, slot transit stubs, and shelf slot assignments.
//
// Reads:   PersonaLayer.getCarrierPosition / getPersonaContainer (narrow read-only)
//          lib/rooms.ts anchors (queue anchors, desk anchors, shelf slots)
//          lib/ticket-carry.ts (carry offsets)
// Mutates: ticket and ticket-hero z-layers only (40 normal, 45 hero; 50 glow)
// Calls:   RoomLayer.setHeroTicketCell on hero promote / release
//
// Does NOT import PersonaLayer internals; uses the narrow public API only.
// Does NOT import from SpriteLayer.

import Phaser from 'phaser';
import type { TicketPlacement } from '../../lib/agent-positions';
import { floorOriginY } from '../../lib/layout';
import { roomDeskAnchors, roomQueueAnchor, roomSlotAnchors } from '../../lib/rooms';
import type { RoomId } from '../../lib/rooms';
import type { IndicatorKind } from '../../lib/state-indicators';
import { ticketCarryOffset } from '../../lib/ticket-carry';
import { TEXTURE_KEYS, indicatorTextureKey } from '../textures';
import type { PersonaLayer } from './PersonaLayer';
import type { DeskClickPayload } from './types';

const TICKET_DEPTH = 40;
const TICKET_HERO_DEPTH = 45;
const GLOW_DEPTH = 50;
const HERO_DURATION_MS = 10_000;

interface TicketEntry {
  ticketId: string;
  externalId: string;
  title: string;
  projectSlug: string;
  workItemId: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  carrierPersonaId: string | null;
  position: TicketPlacement['position'];
  roomId: RoomId | null;
  shelfSlot: number | null;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  /** Small indicator badge above the ticket body (hidden by default, shown by swapIndicator intent). */
  indicator: Phaser.GameObjects.Image;
  hero: boolean;
  glow?: Phaser.GameObjects.Image;
}

interface QueueStack {
  sprite: Phaser.GameObjects.Image;
  badge?: Phaser.GameObjects.Text;
}

interface TicketLayerDeps {
  personaLayer: PersonaLayer;
  setHeroTicketCell: (text: string | null) => void;
  getFloorIndex: (slug: string) => number;
}

export class TicketLayer {
  private readonly scene: Phaser.Scene;
  private readonly emitter: Phaser.Events.EventEmitter;
  private readonly deps: TicketLayerDeps;
  private tickets = new Map<string, TicketEntry>();
  private queueStacks = new Map<string, QueueStack>();
  private heroTicketId: string | null = null;
  private heroTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, emitter: Phaser.Events.EventEmitter, deps: TicketLayerDeps) {
    this.scene = scene;
    this.emitter = emitter;
    this.deps = deps;
  }

  applyPlacements(placements: readonly TicketPlacement[]): void {
    const seen = new Set<string>();

    for (const p of placements) {
      const floorIndex = this.deps.getFloorIndex(p.projectSlug);
      if (floorIndex < 0) continue;
      seen.add(p.ticketId);

      const existing = this.tickets.get(p.ticketId);
      if (existing == null) {
        this.spawn(p, floorIndex);
      } else {
        this.updatePosition(existing, p, floorIndex);
      }
    }

    for (const [id, entry] of this.tickets) {
      if (!seen.has(id)) {
        if (this.heroTicketId === id) this.release();
        entry.glow?.destroy();
        entry.container.destroy();
        this.tickets.delete(id);
      }
    }

    this.updateQueueStacks(placements);
  }

  dropAll(): void {
    if (this.heroTicketId != null) this.release();
    for (const e of this.tickets.values()) {
      e.glow?.destroy();
      e.container.destroy();
    }
    this.tickets.clear();
    for (const qs of this.queueStacks.values()) {
      qs.sprite.destroy();
      qs.badge?.destroy();
    }
    this.queueStacks.clear();
  }

  /**
   * Snaps the ticket to one of the three slot anchor positions (no tween).
   * Phase 5 will replace the snap with a real tween sequence.
   */
  setTicketSlotPosition(
    ticketId: string,
    slotId: string,
    anchorKind: 'queue' | 'exterior' | 'interior',
  ): void {
    const entry = this.tickets.get(ticketId);
    if (entry == null) return;
    const roomId = entry.roomId;
    if (roomId == null) return;

    const slots = roomSlotAnchors(roomId);
    const slot = slots.find((s) => s.id === slotId);
    if (slot == null) return;

    const anchor =
      anchorKind === 'queue'
        ? slot.queueAnchor
        : anchorKind === 'exterior'
          ? slot.exteriorAnchor
          : slot.interiorAnchor;
    if (anchor == null) return;

    this.deparentFromPersona(entry);
    const oy = floorOriginY(this.deps.getFloorIndex(entry.projectSlug));
    entry.container.setPosition(anchor.x, oy + anchor.y);
  }

  /** Promotes a ticket to hero for 10 seconds (or resets the timer if already hero). */
  promote(ticketId: string): void {
    if (this.heroTicketId === ticketId) {
      // Re-click: reset the 10s timer
      this.heroTimer?.destroy();
      this.heroTimer = this.scene.time.delayedCall(HERO_DURATION_MS, () => this.release());
      return;
    }

    // Transfer from previous hero if any
    if (this.heroTicketId != null) this.releaseHeroVisuals(this.heroTicketId);

    this.heroTicketId = ticketId;
    this.emitter.emit('hero-changed', ticketId);

    const entry = this.tickets.get(ticketId);
    if (entry == null) return;

    entry.hero = true;
    entry.container.setDepth(TICKET_HERO_DEPTH);

    // Glow ring
    const glow = this.scene.add.image(0, 0, TEXTURE_KEYS.ticketGlow);
    glow.setOrigin(0.5, 0.5);
    glow.setDepth(GLOW_DEPTH);
    entry.container.add(glow);
    entry.glow = glow;

    // Codename label on carrier persona
    if (entry.carrierPersonaId != null) {
      this.deps.personaLayer.addCodenameLabel(entry.carrierPersonaId);
    }

    // Banner cell
    const display = `#${entry.externalId}${entry.title ? ` — ${entry.title.slice(0, 30)}` : ''}`;
    this.deps.setHeroTicketCell(display);

    this.heroTimer?.destroy();
    this.heroTimer = this.scene.time.delayedCall(HERO_DURATION_MS, () => this.release());
  }

  release(): void {
    const id = this.heroTicketId;
    if (id == null) return;
    this.heroTimer?.destroy();
    this.heroTimer = null;
    this.releaseHeroVisuals(id);
    this.heroTicketId = null;
    this.emitter.emit('hero-changed', null);
    this.deps.setHeroTicketCell(null);
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private releaseHeroVisuals(ticketId: string): void {
    const entry = this.tickets.get(ticketId);
    if (entry == null) return;
    entry.hero = false;
    entry.container.setDepth(TICKET_DEPTH);
    entry.glow?.destroy();
    entry.glow = undefined;
    if (entry.carrierPersonaId != null) {
      this.deps.personaLayer.removeCodenameLabel(entry.carrierPersonaId);
    }
  }

  /** Intent primitive: swap the indicator glyph on a ticket (null → hidden). */
  setIndicator(ticketId: string, glyph: IndicatorKind | null): void {
    const entry = this.tickets.get(ticketId);
    if (entry == null) return;
    if (glyph == null) {
      entry.indicator.setAlpha(0);
    } else {
      entry.indicator.setTexture(indicatorTextureKey(glyph));
      entry.indicator.setAlpha(1);
    }
  }

  private spawn(p: TicketPlacement, floorIndex: number): void {
    const container = this.scene.add.container(0, 0);
    container.setDepth(TICKET_DEPTH);

    const body = this.scene.add.image(0, 0, TEXTURE_KEYS.ticket);
    body.setOrigin(0.5, 0.5);
    this.applyPriorityTint(body, p.priority);
    container.add(body);

    // Small indicator badge above the ticket body; hidden by default.
    const indicator = this.scene.add.image(0, -9, TEXTURE_KEYS.indicatorCoffee);
    indicator.setOrigin(0.5, 1);
    indicator.setScale(0.6);
    indicator.setAlpha(0);
    container.add(indicator);

    container.setSize(14, 10);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-7, -5, 14, 10),
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
        // Read from the live entry so metadata reflects the latest applyPlacements.
        const current = this.tickets.get(p.ticketId);
        if (current != null) {
          this.emitter.emit('desk-click', {
            projectSlug: current.projectSlug,
            workItemId: current.workItemId,
            externalId: current.externalId,
            title: current.title || undefined,
          } satisfies DeskClickPayload);
        }
        this.promote(p.ticketId);
        evt?.stopPropagation();
      },
    );

    const entry: TicketEntry = {
      ticketId: p.ticketId,
      externalId: p.externalId,
      title: p.title,
      projectSlug: p.projectSlug,
      workItemId: p.workItemId,
      priority: p.priority,
      carrierPersonaId: p.carrierPersonaId,
      position: p.position,
      roomId: p.roomId,
      shelfSlot: p.shelfSlot,
      container,
      body,
      indicator,
      hero: false,
    };
    this.tickets.set(p.ticketId, entry);

    this.positionTicket(entry, p, floorIndex);
  }

  private updatePosition(entry: TicketEntry, p: TicketPlacement, floorIndex: number): void {
    // If the hero ticket's carrier changes, transfer the codename label.
    if (entry.hero && entry.carrierPersonaId !== p.carrierPersonaId) {
      if (entry.carrierPersonaId != null) {
        this.deps.personaLayer.removeCodenameLabel(entry.carrierPersonaId);
      }
      if (p.carrierPersonaId != null) {
        this.deps.personaLayer.addCodenameLabel(p.carrierPersonaId);
      }
    }
    entry.title = p.title;
    entry.carrierPersonaId = p.carrierPersonaId;
    entry.position = p.position;
    entry.roomId = p.roomId;
    entry.shelfSlot = p.shelfSlot;
    this.positionTicket(entry, p, floorIndex);
  }

  private positionTicket(entry: TicketEntry, p: TicketPlacement, floorIndex: number): void {
    if (p.position === 'carried' && p.carrierPersonaId != null) {
      this.parentToPersona(entry, p.carrierPersonaId);
      return;
    }

    // Ensure the ticket is not parented to a persona for non-carried positions
    this.deparentFromPersona(entry);

    const oy = floorOriginY(floorIndex);

    if (p.position === 'shelf' && p.roomId === 'done' && p.shelfSlot != null) {
      const anchors = roomDeskAnchors('done');
      const anchor = anchors[p.shelfSlot] ?? anchors[0];
      if (anchor) entry.container.setPosition(anchor.x, oy + anchor.y - 4);
      return;
    }

    if (p.position === 'queue' && p.roomId != null) {
      const qa = roomQueueAnchor(p.roomId);
      if (qa) entry.container.setPosition(qa.x, oy + qa.y);
      return;
    }

    if (p.position === 'slot' && p.slotId != null && p.roomId != null) {
      // Phase 3 stub: snap to exterior anchor, no tween
      this.setTicketSlotPosition(p.ticketId, p.slotId, 'exterior');
      return;
    }

    // 'free' or unhandled — hold at last known position
  }

  private parentToPersona(entry: TicketEntry, personaId: string): void {
    const container = this.deps.personaLayer.getPersonaContainer(personaId);
    if (container == null) {
      // Persona not found; free-float at carry position (no-op for now)
      return;
    }

    if (entry.container.parentContainer !== container) {
      // Re-parent to persona container
      if (entry.container.parentContainer) {
        entry.container.parentContainer.remove(entry.container);
      }
      const { dx, dy } = ticketCarryOffset();
      entry.container.setPosition(dx, dy);
      container.add(entry.container);
    }
  }

  private deparentFromPersona(entry: TicketEntry): void {
    if (!entry.container.parentContainer) return;
    const worldPos = entry.container.getWorldTransformMatrix();
    entry.container.parentContainer.remove(entry.container);
    this.scene.add.existing(entry.container);
    entry.container.setPosition(worldPos.tx, worldPos.ty);
  }

  private applyPriorityTint(body: Phaser.GameObjects.Image, priority: string): void {
    const tints: Record<string, number> = {
      critical: 0xff4444,
      high: 0xff9900,
      normal: 0xffffff,
      low: 0x88bbff,
    };
    body.setTint(tints[priority] ?? 0xffffff);
  }

  private updateQueueStacks(placements: readonly TicketPlacement[]): void {
    // Key: `${floorIndex}:${roomId}` → accumulated depth
    const floorRoomDepths = new Map<
      string,
      { roomId: RoomId; floorIndex: number; depth: number }
    >();
    const heroIsQueued = new Set<string>(); // `${floorIndex}:${roomId}`

    for (const p of placements) {
      if (p.position !== 'queue' || p.roomId == null) continue;
      const floorIndex = this.deps.getFloorIndex(p.projectSlug);
      if (floorIndex < 0) continue;
      const ck = `${floorIndex}:${p.roomId}`;
      if (p.ticketId === this.heroTicketId) {
        heroIsQueued.add(ck);
      } else {
        const e = floorRoomDepths.get(ck);
        if (e) {
          e.depth++;
        } else {
          floorRoomDepths.set(ck, { roomId: p.roomId as RoomId, floorIndex, depth: 1 });
        }
      }
    }

    // Hide stacks for floor/room combos that no longer have queued tickets.
    for (const storeKey of this.queueStacks.keys()) {
      const ck = storeKey.slice('queue:'.length);
      if (!floorRoomDepths.has(ck) && !heroIsQueued.has(ck)) {
        const qs = this.queueStacks.get(storeKey);
        if (qs == null) continue;
        qs.sprite.setVisible(false);
        qs.badge?.setVisible(false);
      }
    }

    // Create or update stacks for active floor/room combos.
    for (const [ck, { roomId, floorIndex, depth }] of floorRoomDepths) {
      const qa = roomQueueAnchor(roomId);
      if (qa == null) continue;
      const oy = floorOriginY(floorIndex);

      const storeKey = `queue:${ck}`;
      let qs = this.queueStacks.get(storeKey);

      if (qs == null) {
        const sprite = this.scene.add.image(qa.x, oy + qa.y, TEXTURE_KEYS.queueStack1);
        sprite.setOrigin(0.5, 0.5);
        sprite.setDepth(TICKET_DEPTH - 1);
        qs = { sprite };
        this.queueStacks.set(storeKey, qs);
      }

      qs.sprite.setVisible(depth > 0);
      qs.sprite.setPosition(qa.x, oy + qa.y);

      if (depth >= 4) {
        qs.sprite.setTexture(TEXTURE_KEYS.queueStackMany);
      } else if (depth >= 3) {
        qs.sprite.setTexture(TEXTURE_KEYS.queueStack3);
      } else if (depth >= 2) {
        qs.sprite.setTexture(TEXTURE_KEYS.queueStack2);
      } else {
        qs.sprite.setTexture(TEXTURE_KEYS.queueStack1);
      }

      if (depth >= 4) {
        if (qs.badge == null) {
          qs.badge = this.scene.add.text(qa.x + 6, oy + qa.y - 4, '', {
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '6px',
            color: '#ffffff',
            backgroundColor: '#6b4a8e',
            padding: { left: 1, right: 1, top: 0, bottom: 0 },
          });
          qs.badge.setOrigin(0.5, 1);
          qs.badge.setDepth(TICKET_DEPTH);
        }
        qs.badge.setText(`+${depth}`);
        qs.badge.setVisible(true);
      } else {
        qs.badge?.setVisible(false);
      }
    }
  }
}
