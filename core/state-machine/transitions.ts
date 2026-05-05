import type { StateName } from './states.js';

const TRANSITIONS: Readonly<Record<StateName, readonly StateName[]>> = {
  'factory:triaging': ['factory:accepted', 'factory:rejected'],
  'factory:accepted': [
    'factory:grilling',
    'factory:investigating',
    'factory:dev-ready',
    'factory:research-pending',
  ],
  'factory:rejected': ['factory:archived'],
  'factory:grilling': ['factory:prd-drafting'],
  'factory:prd-drafting': ['factory:prd-review'],
  'factory:prd-review': ['factory:decomposing'],
  'factory:decomposing': ['factory:issues-created'],
  'factory:issues-created': ['factory:dev-ready'],
  'factory:research-pending': ['factory:research-complete'],
  'factory:research-complete': ['factory:dev-ready'],
  'factory:investigating': ['factory:investigation-complete', 'factory:needs-human'],
  'factory:investigation-complete': ['factory:dev-ready', 'factory:gate-pending'],
  'factory:gate-pending': ['factory:dev-ready'],
  'factory:dev-ready': ['factory:in-progress'],
  'factory:in-progress': ['factory:needs-qa', 'factory:needs-human'],
  'factory:needs-qa': ['factory:qa-failed', 'factory:needs-review', 'factory:needs-human'],
  'factory:qa-failed': ['factory:needs-fix', 'factory:needs-human'],
  // needs-review → rejected covers the "human explicitly cancelled" case from section 9.2
  'factory:needs-review': [
    'factory:needs-fix',
    'factory:approved',
    'factory:needs-human',
    'factory:rejected',
  ],
  'factory:needs-fix': ['factory:in-progress', 'factory:needs-human'],
  'factory:approved': ['factory:retrospecting', 'factory:merge-conflict', 'factory:needs-fix'],
  'factory:merge-conflict': ['factory:retrospecting', 'factory:needs-human'],
  'factory:retrospecting': ['factory:done'],
  'factory:needs-human': [
    'factory:dev-ready',
    'factory:needs-qa',
    'factory:triaging',
    'factory:rejected',
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
