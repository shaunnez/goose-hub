// Derives { personas, tickets } from the canonical work-item list.
// Pure derivation — no Phaser imports, no side effects.
//
// PersonaPlacement: one entry per active non-terminal item (with optional
//   freeze for stay-put states).
// TicketPlacement: one entry per visible work item, including done (shelf)
//   and stay-put (carried by frozen persona).

import { codenameFor } from './persona-codenames';
import type { RoomId } from './rooms';
import { IDLE_INDICATOR, type IndicatorKind, indicatorForState } from './state-indicators';
import { OFFICE_ROLES, type OfficeRole } from './state-to-role';
import {
  DONE_STATES,
  STAY_PUT_STATES,
  TERMINAL_STATES,
  deskSlotForRoom,
  roomForState,
} from './state-to-room';

// ─── Input ───────────────────────────────────────────────────────────────────

export interface AgentPlacementInput {
  workItemId: string;
  externalId: string;
  projectSlug: string;
  state: string;
  personaId?: string | null;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  title?: string;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface PersonaPlacement {
  /** "${projectSlug}:${externalId}" — stable across state transitions */
  personaId: string;
  codename: string;
  projectSlug: string;
  workItemId: string;
  externalId: string;
  /** null = freeze in place (needs-human / gate-pending) */
  roomId: RoomId | null;
  /** 0-based index into roomDeskAnchors(roomId); -1 when frozen / queued */
  deskSlot: number;
  indicator: IndicatorKind;
  title?: string;
}

export interface TicketPlacement {
  /** "${projectSlug}:${externalId}" — stable identity key */
  ticketId: string;
  externalId: string;
  title: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  /** null when ticket has no active carrier (queue, slot, shelf, free) */
  carrierPersonaId: string | null;
  position: 'carried' | 'desk' | 'queue' | 'slot' | 'shelf' | 'free';
  roomId: RoomId | null;
  slotId: string | null;
  /** 0-based shelf slot in Done room (0..4); null when not on shelf */
  shelfSlot: number | null;
  indicator: IndicatorKind | null;
  projectSlug: string;
  workItemId: string;
}

// ─── Main derivation ──────────────────────────────────────────────────────────

/**
 * Returns { personas, tickets } for all visible work items.
 *
 * Exclusions:
 *   - archived / rejected → dropped entirely
 *   - unknown states without a room mapping → dropped
 *   - done → ticket only (shelf), no persona
 */
export function placementsFromItems(items: readonly AgentPlacementInput[]): {
  personas: PersonaPlacement[];
  tickets: TicketPlacement[];
} {
  const personas: PersonaPlacement[] = [];
  const tickets: TicketPlacement[] = [];
  const shelfIndices = new Map<string, number>();

  for (const item of items) {
    const { workItemId, externalId, projectSlug, state, priority = 'normal', title } = item;
    const personaId = `${projectSlug}:${externalId}`;
    const ticketId = personaId;
    const indicator = indicatorForState(state);

    // Archived / rejected — removed entirely
    if (TERMINAL_STATES.has(state)) continue;

    // Done — ticket only, positioned on the shelf
    if (DONE_STATES.has(state)) {
      tickets.push({
        ticketId,
        externalId,
        title: title ?? '',
        priority,
        carrierPersonaId: null,
        position: 'shelf',
        roomId: 'done',
        slotId: null,
        shelfSlot: (shelfIndices.get(projectSlug) ?? 0) % 5,
        indicator,
        projectSlug,
        workItemId,
      });
      shelfIndices.set(projectSlug, (shelfIndices.get(projectSlug) ?? 0) + 1);
      continue;
    }

    // Stay-put — persona freezes at last known position; ticket stays carried
    if (STAY_PUT_STATES.has(state)) {
      personas.push({
        personaId,
        codename: codenameFor(personaId),
        projectSlug,
        workItemId,
        externalId,
        roomId: null,
        deskSlot: -1,
        indicator,
        title,
      });
      // Stay-put has no concrete room, so the ticket floats free.
      // TicketLayer cannot parent to a persona with no known desk position.
      tickets.push({
        ticketId,
        externalId,
        title: title ?? '',
        priority,
        carrierPersonaId: null,
        position: 'free',
        roomId: null,
        slotId: null,
        shelfSlot: null,
        indicator,
        projectSlug,
        workItemId,
      });
      continue;
    }

    // Active state — map to room + desk slot
    const roomId = roomForState(state);
    if (roomId == null) continue; // unknown state — drop

    const deskSlot = deskSlotForRoom(roomId, externalId);

    personas.push({
      personaId,
      codename: codenameFor(personaId),
      projectSlug,
      workItemId,
      externalId,
      roomId,
      deskSlot,
      indicator,
      title,
    });
    tickets.push({
      ticketId,
      externalId,
      title: title ?? '',
      priority,
      carrierPersonaId: personaId,
      position: 'carried',
      roomId,
      slotId: null,
      shelfSlot: null,
      indicator,
      projectSlug,
      workItemId,
    });
  }

  return { personas, tickets };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOM_REPRESENTATIVE_ROLE: Partial<Record<RoomId, OfficeRole>> = {
  triage: 'triager',
  investigation: 'investigator',
  dev: 'developer',
  qa: 'qa',
  review: 'reviewer',
};

/**
 * Returns the set of roles that currently have at least one active persona.
 * Used by the scene to toggle idle desk indicators in RoomLayer.
 */
export function busyRoles(personas: PersonaPlacement[]): Set<OfficeRole> {
  const set = new Set<OfficeRole>();
  for (const p of personas) {
    if (p.roomId == null) continue;
    const role = ROOM_REPRESENTATIVE_ROLE[p.roomId];
    if (role != null) set.add(role);
  }
  return set;
}

export function idleIndicator(): IndicatorKind {
  return IDLE_INDICATOR;
}

export { OFFICE_ROLES };
