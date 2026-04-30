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
  'factory:dev-ready',
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:retrospecting',
  'factory:needs-human',
  'factory:done',
  'factory:archived',
] as const);

export type StateName = (typeof STATES)[number];
export type State = StateName;
