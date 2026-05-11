export const STATES = Object.freeze([
  'factory:triaging',
  'factory:accepted',
  'factory:rejected',
  'factory:grilling',
  'factory:prd-drafting',
  'factory:prd-review',
  'factory:decomposing',
  'factory:issues-created',
  'factory:research-pending',
  'factory:research-complete',
  'factory:investigating',
  'factory:investigation-complete',
  'factory:gate-pending',
  'factory:dev-ready',
  'factory:spec-ready',
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:merge-conflict',
  'factory:retrospecting',
  'factory:needs-human',
  'factory:done',
  'factory:archived',
] as const);

export type StateName = (typeof STATES)[number];
export type State = StateName;

/**
 * Terminal states a work item can settle into. Used by sprint-review filtering
 * and CLI dashboards to exclude items no longer in active flow.
 */
export const TERMINAL_STATES: ReadonlySet<StateName> = new Set<StateName>([
  'factory:done',
  'factory:archived',
  'factory:rejected',
]);
