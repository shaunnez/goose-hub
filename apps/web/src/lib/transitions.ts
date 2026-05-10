// Mirror of `core/state-machine/transitions.ts` for the browser. The server
// is the authority — the client only uses this to filter what legal targets
// to show in the Transition popover. Server still validates with 422 on
// illegal inputs.

// States excluded from the transition dropdown based on work item type.
// Bugs skip the grill/PRD/research path; features skip the investigation path.
export const TYPE_EXCLUDED_TARGETS: Readonly<Record<string, readonly string[]>> = {
  bug: ['factory:grilling', 'factory:research-pending'],
  feature: ['factory:investigating', 'factory:research-pending'],
};

export const LEGAL_TARGETS: Readonly<Record<string, readonly string[]>> = {
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
  'factory:issues-created': ['factory:dev-ready', 'factory:archived'],
  'factory:research-pending': ['factory:research-complete', 'factory:archived'],
  'factory:research-complete': ['factory:dev-ready', 'factory:archived'],
  'factory:investigating': ['factory:investigation-complete', 'factory:archived'],
  'factory:investigation-complete': ['factory:dev-ready', 'factory:archived'],
  'factory:dev-ready': ['factory:in-progress', 'factory:archived'],
  'factory:in-progress': ['factory:needs-qa', 'factory:archived'],
  'factory:needs-qa': ['factory:qa-failed', 'factory:needs-review', 'factory:archived'],
  'factory:qa-failed': ['factory:needs-fix', 'factory:archived'],
  'factory:needs-review': [
    'factory:needs-fix',
    'factory:approved',
    'factory:needs-human',
    'factory:rejected',
    'factory:archived',
  ],
  'factory:needs-fix': ['factory:in-progress', 'factory:needs-human', 'factory:archived'],
  'factory:approved': ['factory:retrospecting', 'factory:merge-conflict', 'factory:archived'],
  'factory:merge-conflict': ['factory:done', 'factory:needs-human', 'factory:archived'],
  'factory:retrospecting': ['factory:done', 'factory:archived'],
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
