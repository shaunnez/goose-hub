// Mirror of `core/state-machine/transitions.ts` for the browser. The server
// is the authority — the client only uses this to filter what legal targets
// to show in the Transition popover. Server still validates with 422 on
// illegal inputs.

export const LEGAL_TARGETS: Readonly<Record<string, readonly string[]>> = {
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
  'factory:investigating': ['factory:investigation-complete'],
  'factory:investigation-complete': ['factory:dev-ready'],
  'factory:dev-ready': ['factory:in-progress'],
  'factory:in-progress': ['factory:needs-qa'],
  'factory:needs-qa': ['factory:qa-failed', 'factory:needs-review'],
  'factory:qa-failed': ['factory:needs-fix'],
  'factory:needs-review': [
    'factory:needs-fix',
    'factory:approved',
    'factory:needs-human',
    'factory:rejected',
  ],
  'factory:needs-fix': ['factory:in-progress', 'factory:needs-human'],
  'factory:approved': ['factory:retrospecting'],
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
