import type { StateName } from '../state-machine/states.js';
import type { WorkItemType } from '../state-source/interface.js';

export const TRIAGE_ROUTE_TARGETS = Object.freeze({
  bug: 'factory:investigating',
  research: 'factory:research-pending',
  freshFeature: 'factory:grilling',
  chore: 'factory:dev-ready',
  prdFeature: 'factory:dev-ready',
} satisfies Record<string, StateName>);

export function targetStateForTriage(
  type: WorkItemType,
  labels: readonly string[] = [],
): StateName {
  if (type === 'bug') return TRIAGE_ROUTE_TARGETS.bug;
  if (type === 'research') return TRIAGE_ROUTE_TARGETS.research;
  if (type === 'feature' && !labels.includes('factory:from-prd')) {
    return TRIAGE_ROUTE_TARGETS.freshFeature;
  }
  return TRIAGE_ROUTE_TARGETS.chore;
}
