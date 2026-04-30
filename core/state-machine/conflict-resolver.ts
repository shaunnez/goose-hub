import { STATES, type StateName } from './states.js';
import { isLegalTransition } from './transitions.js';

export type ConflictReason =
  | 'zero-factory-labels'
  | 'multiple-state-labels'
  | 'unknown-factory-label'
  | 'archived-wins'
  | 'illegal-transition';

export interface ConflictResult {
  state: StateName;
  conflicts: ConflictReason[];
}

const STATES_SET = new Set<string>(STATES);
const ARCHIVED: StateName = 'factory:archived';

/**
 * Resolve the effective state from a set of GitHub issue labels.
 *
 * Rules (in priority order):
 *  1. Zero factory:* state labels → default to 'factory:triaging', conflict 'zero-factory-labels'
 *  2. Unknown factory:* labels (has prefix but not in STATES) → ignored, conflict 'unknown-factory-label'
 *  3. factory:archived + any other state → archived wins, conflict 'archived-wins'
 *  4. Two or more known state labels → highest canonical index wins, conflict 'multiple-state-labels'
 *  5. Single known state label → no conflict
 */
export function resolveState(labels: string[]): ConflictResult {
  const conflicts: ConflictReason[] = [];

  const factoryLabels = labels.filter((l) => l.startsWith('factory:'));
  const unknownFactoryLabels = factoryLabels.filter((l) => !STATES_SET.has(l));
  const knownStateLabels = factoryLabels.filter((l) => STATES_SET.has(l)) as StateName[];

  if (unknownFactoryLabels.length > 0) {
    conflicts.push('unknown-factory-label');
  }

  if (knownStateLabels.length === 0) {
    conflicts.push('zero-factory-labels');
    return { state: 'factory:triaging', conflicts };
  }

  if (knownStateLabels.includes(ARCHIVED) && knownStateLabels.length > 1) {
    conflicts.push('archived-wins');
    return { state: ARCHIVED, conflicts };
  }

  if (knownStateLabels.length > 1) {
    conflicts.push('multiple-state-labels');
    // Pick the label with the highest index in the canonical STATES array.
    const winner = knownStateLabels.reduce((best, label) => {
      return STATES.indexOf(label) > STATES.indexOf(best) ? label : best;
    });
    return { state: winner, conflicts };
  }

  return { state: knownStateLabels[0], conflicts };
}

/**
 * Check whether a state transition is legal.
 *
 * Rule 6: from === null (no prior state) is always legal.
 * Rule 7: an illegal transition is flagged with reason 'illegal-transition'.
 */
export function checkTransition(
  from: StateName | null,
  to: StateName,
): { legal: boolean; reason: ConflictReason | null } {
  if (from === null || isLegalTransition(from, to)) {
    return { legal: true, reason: null };
  }
  return { legal: false, reason: 'illegal-transition' };
}
