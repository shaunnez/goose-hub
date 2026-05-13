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
  'factory:triaging': 'triage',
  'factory:accepted': 'triage',
  'factory:grilling': 'triage',
  'factory:prd-drafting': 'triage',
  'factory:prd-review': 'triage',
  'factory:decomposing': 'triage',
  'factory:issues-created': 'triage',
  'factory:research-pending': 'triage',
  'factory:research-complete': 'triage',
  'factory:retrospecting': 'triage',
  'factory:investigating': 'investigation',
  'factory:investigation-complete': 'investigation',
  'factory:dev-ready': 'dev',
  'factory:spec-ready': 'dev',
  'factory:in-progress': 'dev',
  'factory:needs-fix': 'dev',
  'factory:qa-failed': 'dev',
  'factory:needs-qa': 'qa',
  'factory:needs-review': 'review',
  'factory:approved': 'review',
  'factory:merge-conflict': 'review',
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

/**
 * Returns the 0-based desk slot index within roomDeskAnchors(room) for the
 * given room and externalId. The externalId is hashed deterministically so
 * the same issue always picks the same desk within a session.
 *
 * Slot assignments per room:
 *   triage:       always 0 (one triager desk)
 *   investigation: always 3 (lead investigator desk)
 *   dev:          hash(externalId) % 3 (three builder desks)
 *   qa:           always 0 (first QA station)
 *   review:       always 0 (first reviewer spot)
 *   done:         caller handles shelf slot separately
 */
export function deskSlotForRoom(room: RoomId, externalId: string): number {
  switch (room) {
    case 'triage':
      return 0;
    case 'investigation':
      return 3; // lead investigator desk
    case 'dev': {
      // Deterministic hash of externalId → desk 0, 1, or 2
      let h = 2166136261;
      for (let i = 0; i < externalId.length; i++) {
        h ^= externalId.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h % 3;
    }
    case 'qa':
      return 0;
    case 'review':
      return 0;
    case 'done':
      return 0; // shelf slot assigned separately per ticket index
  }
}
