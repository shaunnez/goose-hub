// Maps `factory:*` state labels to the room a persona occupies on the
// canonical project floor (Board 02 §12 active-state table).
//
// Returns null for: stay-put blocked states (needs-human, gate-pending),
// done/archived/rejected terminal states (handled separately by TicketLayer
// for shelf placement), and unknown states.
//
// deskSlotForRoom derives the 0-based desk index within roomDeskAnchors(room).
// No Phaser imports; pure derivation.

import type { RoomId } from './rooms';

const STATE_TO_ROOM: Readonly<Record<string, RoomId | null>> = {
  // Triage cluster — intake + early reasoning lives in triage
  'factory:triaging': 'triage',
  'factory:accepted': 'triage',
  'factory:grilling': 'triage',
  'factory:prd-drafting': 'triage',
  'factory:prd-review': 'triage',
  // Decomposition produces backlog items — natural home
  'factory:decomposing': 'backlog',
  'factory:issues-created': 'backlog',
  // Research happens in the library
  'factory:research-pending': 'library',
  'factory:research-complete': 'library',
  // Investigation lab
  'factory:investigating': 'investigation',
  'factory:investigation-complete': 'investigation',
  // Dev floor
  'factory:dev-ready': 'dev',
  'factory:spec-ready': 'dev',
  'factory:in-progress': 'dev',
  'factory:needs-fix': 'dev',
  'factory:qa-failed': 'dev',
  // QA chamber
  'factory:needs-qa': 'qa',
  // Review chamber
  'factory:needs-review': 'review',
  'factory:approved': 'review',
  'factory:merge-conflict': 'review',
  // Retro room
  'factory:retrospecting': 'retro',
  // Stay-put states — handled by caller; persona freezes in place
  'factory:needs-human': null,
  'factory:gate-pending': null,
  // Terminal states — handled by caller; ticket goes to shelf or removed
  'factory:done': null,
  'factory:archived': null,
  'factory:rejected': null,
};

export function roomForState(state: string): RoomId | null {
  return STATE_TO_ROOM[state] ?? null;
}

export const STAY_PUT_STATES = new Set<string>(['factory:needs-human', 'factory:gate-pending']);
export const DONE_STATES = new Set<string>(['factory:done']);
export const TERMINAL_STATES = new Set<string>(['factory:archived', 'factory:rejected']);

function hashExternalId(externalId: string): number {
  let h = 2166136261;
  for (let i = 0; i < externalId.length; i++) {
    h ^= externalId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Returns the 0-based desk slot index within roomDeskAnchors(room) for the
 * given room and externalId. The externalId is hashed deterministically so
 * the same issue always picks the same desk within a session.
 *
 * Slot assignments per room:
 *   triage / qa / review / retro:     hash → first 3 desks
 *   investigation / library / backlog: hash → 3 desks
 *   dev:           hash → 3 builder desks
 *   done / archive: caller handles shelf slot separately (returns 0)
 *   coffee:        hash → 3 coffee benches
 */
export function deskSlotForRoom(room: RoomId, externalId: string): number {
  const h = hashExternalId(externalId);
  switch (room) {
    case 'dev':
    case 'qa':
    case 'review':
    case 'retro':
    case 'backlog':
    case 'triage':
    case 'investigation':
    case 'library':
    case 'coffee':
      return h % 3;
    case 'done':
    case 'archive':
      return 0; // shelf slot assigned separately per ticket index
  }
}
