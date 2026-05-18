// Pure derivation of HudState from persona/ticket placements + recent events.
// No Phaser imports, no DOM access, no side effects.

import type { PersonaPlacement, TicketPlacement } from './agent-positions';
import { ROOM_IDS, type RoomId } from './rooms';

export interface HudState {
  hero: {
    ticketId: string;
    personaId: string | null;
    priority: 'critical' | 'high' | 'normal' | 'low';
    bannerLabel: string;
    qualityScore: number | null;
  } | null;
  queues: Record<RoomId, number>;
  pressure: Record<RoomId, number>;
  retry: Record<string, number>;
  reviewRound: number | null;
  blocked: Array<{ personaId: string; mode: 'gate-pending' | 'needs-human' }>;
  camera: { anchor: 'floor-overview' | 'hero-ticket-follow'; ticketId?: string };
  doneToday: number;
}

export interface HudEvents {
  retryIncremented: string[]; // ticketIds that had a retry this batch
  mergedCelebrated: string[]; // ticketIds that merged this batch
}

function emptyRoomRecord(): Record<RoomId, number> {
  return Object.fromEntries(ROOM_IDS.map((roomId) => [roomId, 0])) as Record<RoomId, number>;
}

function truncateTitle(title: string, len = 36): string {
  return title.length > len ? `${title.slice(0, len)}…` : title;
}

export function hudStateFromPlacements(
  personas: PersonaPlacement[],
  tickets: TicketPlacement[],
  prev: HudState | null,
  events: HudEvents,
): HudState {
  // Carry forward accumulators from previous state
  const retryMap: Record<string, number> = { ...(prev?.retry ?? {}) };
  let doneToday = prev?.doneToday ?? 0;

  // Apply event batch accumulators
  for (const ticketId of events.retryIncremented) {
    retryMap[ticketId] = (retryMap[ticketId] ?? 0) + 1;
  }
  doneToday += events.mergedCelebrated.length;

  // Derive per-room pressure (in-flight ticket count)
  const pressure = emptyRoomRecord();
  for (const t of tickets) {
    if (t.roomId != null && t.position !== 'shelf') {
      pressure[t.roomId] = (pressure[t.roomId] ?? 0) + 1;
    }
  }

  // Derive per-room queue depths: tickets in 'queue' position
  const queues = emptyRoomRecord();
  for (const t of tickets) {
    if (t.position === 'queue' && t.roomId != null) {
      queues[t.roomId] = (queues[t.roomId] ?? 0) + 1;
    }
  }

  // Derive blocked personas (stay-put: roomId=null means frozen)
  const blocked: HudState['blocked'] = [];
  for (const p of personas) {
    if (p.roomId === null) {
      const mode = p.indicator === 'bang' ? 'gate-pending' : 'needs-human';
      blocked.push({ personaId: p.personaId, mode });
    }
  }

  // Derive hero: hero ticket is the one with a carrier persona
  // Prefer the carried ticket in Review for round counter purposes
  // Hero = first carried ticket (or first ticket by externalId if multiple)
  const heroTicket = tickets.find((t) => t.carrierPersonaId != null) ?? null;
  let hero: HudState['hero'] = null;
  if (heroTicket != null) {
    const externalId = heroTicket.externalId;
    const title = heroTicket.title ?? '';
    const bannerLabel = `#${externalId} — ${truncateTitle(title)}`;
    hero = {
      ticketId: heroTicket.ticketId,
      personaId: heroTicket.carrierPersonaId,
      priority: heroTicket.priority,
      bannerLabel,
      qualityScore:
        (heroTicket as TicketPlacement & { qualityScore?: number }).qualityScore ?? null,
    };
  }

  // Review round: if hero is in Review, check prev round or default to 1
  const heroInReview = heroTicket?.roomId === 'review';
  const reviewRound = heroInReview ? (prev?.reviewRound ?? 1) : null;

  // Reset retry counter if hero ticket transitions to done/terminal
  if (heroTicket == null || heroTicket.position === 'shelf') {
    // Hero gone — keep retries but clear hero-specific state (camera defaults)
  }

  // Reset done-today if prev had doneToday and we're accumulating from events
  // (no reset here; midnight reset is handled by HudLayer's interval)

  const camera: HudState['camera'] = prev?.camera ?? { anchor: 'floor-overview' };

  return {
    hero,
    queues,
    pressure,
    retry: retryMap,
    reviewRound,
    blocked,
    camera,
    doneToday,
  };
}

// Utility: reset doneToday counter (called by HudLayer on midnight tick)
export function resetDoneToday(state: HudState): HudState {
  return { ...state, doneToday: 0 };
}

// Utility: apply camera state update
export function withCameraState(
  state: HudState,
  anchor: 'floor-overview' | 'hero-ticket-follow',
  ticketId?: string,
): HudState {
  return { ...state, camera: { anchor, ticketId } };
}

// Utility: increment review round for hero
export function incrementReviewRound(state: HudState): HudState {
  const round = state.reviewRound ?? 1;
  return { ...state, reviewRound: round + 1 };
}
