import type { StateName } from './states.js';

const TRANSITIONS: Readonly<Record<StateName, readonly StateName[]>> = {
  'factory:triaging': ['factory:accepted', 'factory:rejected', 'factory:archived'],
  'factory:accepted': [
    'factory:grilling',
    'factory:investigating',
    'factory:dev-ready',
    'factory:research-pending',
    'factory:archived',
  ],
  'factory:rejected': ['factory:archived'],
  'factory:grilling': ['factory:prd-drafting', 'factory:archived'],
  'factory:prd-drafting': ['factory:prd-review', 'factory:archived'],
  'factory:prd-review': ['factory:decomposing', 'factory:archived'],
  'factory:decomposing': ['factory:issues-created', 'factory:archived'],
  'factory:issues-created': ['factory:dev-ready', 'factory:done', 'factory:archived'],
  'factory:research-pending': ['factory:research-complete', 'factory:archived'],
  'factory:research-complete': ['factory:dev-ready', 'factory:archived'],
  'factory:investigating': [
    'factory:investigation-complete',
    'factory:needs-human',
    'factory:archived',
  ],
  'factory:investigation-complete': [
    'factory:dev-ready',
    'factory:gate-pending',
    'factory:archived',
  ],
  'factory:gate-pending': ['factory:dev-ready', 'factory:grilling', 'factory:archived'],
  'factory:dev-ready': [
    'factory:spec-ready',
    'factory:in-progress',
    'factory:needs-human',
    'factory:archived',
  ],
  'factory:spec-ready': ['factory:in-progress', 'factory:needs-human', 'factory:archived'],
  'factory:in-progress': ['factory:needs-qa', 'factory:needs-human', 'factory:archived'],
  'factory:needs-qa': [
    'factory:qa-failed',
    'factory:needs-review',
    'factory:needs-human',
    'factory:archived',
  ],
  'factory:qa-failed': ['factory:needs-fix', 'factory:needs-human', 'factory:archived'],
  // needs-review → rejected covers the "human explicitly cancelled" case from section 9.2
  'factory:needs-review': [
    'factory:needs-fix',
    'factory:approved',
    'factory:needs-human',
    'factory:rejected',
    'factory:archived',
  ],
  'factory:needs-fix': ['factory:in-progress', 'factory:needs-human', 'factory:archived'],
  'factory:approved': [
    'factory:retrospecting',
    'factory:merge-conflict',
    'factory:needs-fix',
    'factory:needs-human',
    'factory:archived',
  ],
  'factory:merge-conflict': [
    'factory:retrospecting',
    'factory:done',
    'factory:needs-human',
    'factory:archived',
  ],
  'factory:retrospecting': ['factory:done', 'factory:needs-human', 'factory:archived'],
  'factory:needs-human': [
    'factory:dev-ready',
    'factory:needs-qa',
    'factory:triaging',
    'factory:rejected',
    'factory:archived',
  ],
  'factory:done': ['factory:archived'],
  'factory:archived': [],
} as const;

export function legalTargets(from: StateName): readonly StateName[] {
  return TRANSITIONS[from];
}

export function isLegalTransition(from: StateName, to: StateName): boolean {
  return (TRANSITIONS[from] as readonly string[]).includes(to);
}
