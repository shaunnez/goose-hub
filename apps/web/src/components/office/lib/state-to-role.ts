// Maps `factory:*` state labels to the role whose desk an agent should sit at.
//
// The mapping mirrors the same domain knowledge encoded in `lib/lanes.config.ts`
// but at desk granularity: lanes group multiple states into one column; the
// office grid wants exactly one desk per role.
//
// "Terminal" states (`done`, `archived`, `rejected`) and out-of-band states
// (`needs-human`, `gate-pending`) return `null` — the sprite should stay at
// its previous desk and switch indicator instead of walking.

// Subset of the canonical `Role` union (`core/types.ts`) that has a desk in
// the office. `dev-reviewer` and `auditor` aren't shown — they don't have
// dedicated state-machine entries on the kanban. Mirror this list if Role
// changes upstream.
export type OfficeRole =
  | 'triager'
  | 'griller'
  | 'prd-writer'
  | 'decomposer'
  | 'researcher'
  | 'investigator'
  | 'developer'
  | 'qa'
  | 'reviewer'
  | 'retrospector';

export const OFFICE_ROLES: readonly OfficeRole[] = [
  'triager',
  'griller',
  'prd-writer',
  'decomposer',
  'researcher',
  'investigator',
  'developer',
  'qa',
  'reviewer',
  'retrospector',
] as const;

const STATE_TO_ROLE: Readonly<Record<string, OfficeRole | null>> = {
  'factory:triaging': 'triager',
  'factory:accepted': 'triager',
  'factory:grilling': 'griller',
  'factory:prd-drafting': 'prd-writer',
  'factory:prd-review': 'prd-writer',
  'factory:decomposing': 'decomposer',
  'factory:issues-created': 'decomposer',
  'factory:research-pending': 'researcher',
  'factory:research-complete': 'researcher',
  'factory:investigating': 'investigator',
  'factory:investigation-complete': 'investigator',
  'factory:dev-ready': 'developer',
  'factory:spec-ready': 'developer',
  'factory:in-progress': 'developer',
  'factory:needs-fix': 'developer',
  'factory:qa-failed': 'developer',
  'factory:needs-qa': 'qa',
  'factory:needs-review': 'reviewer',
  'factory:approved': 'reviewer',
  'factory:merge-conflict': 'reviewer',
  'factory:retrospecting': 'retrospector',
  'factory:needs-human': null,
  'factory:gate-pending': null,
  'factory:done': null,
  'factory:archived': null,
  'factory:rejected': null,
};

/**
 * Returns the role-desk a sprite should sit at for the given state, or `null`
 * if the state should not move the sprite (terminal / human-gate states).
 */
export function deskForState(state: string): OfficeRole | null {
  if (!(state in STATE_TO_ROLE)) return null;
  return STATE_TO_ROLE[state];
}

/**
 * True if a state transition should trigger a walk. Returns `false` when:
 * - either side is unknown,
 * - either side maps to no desk (terminal / human-gate),
 * - or both sides map to the same desk.
 */
export function shouldWalk(fromState: string, toState: string): boolean {
  const fromDesk = deskForState(fromState);
  const toDesk = deskForState(toState);
  if (fromDesk == null || toDesk == null) return false;
  return fromDesk !== toDesk;
}
