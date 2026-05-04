// Shared display constants for work-item state and priority.
// Priority colour-coding per issue #32: critical=red, high=orange, medium=yellow, low=grey.
// These replace local duplicates in TaskHeader.tsx, IssueCard.tsx, and gate-states.ts.
export const STATE_LABEL: Record<string, string> = {
  'factory:triaging': 'triaging',
  'factory:accepted': 'accepted',
  'factory:rejected': 'rejected',
  'factory:grilling': 'grilling',
  'factory:prd-drafting': 'prd-drafting',
  'factory:prd-review': 'prd-review',
  'factory:decomposing': 'decomposing',
  'factory:issues-created': 'issues-created',
  'factory:research-pending': 'research-pending',
  'factory:research-complete': 'research-complete',
  'factory:investigating': 'investigating',
  'factory:investigation-complete': 'investigation-complete',
  'factory:dev-ready': 'dev-ready',
  'factory:in-progress': 'in-progress',
  'factory:needs-qa': 'needs-qa',
  'factory:qa-failed': 'qa-failed',
  'factory:needs-review': 'needs-review',
  'factory:needs-fix': 'needs-fix',
  'factory:approved': 'approved',
  'factory:retrospecting': 'retrospecting',
  'factory:needs-human': 'needs-human',
  'factory:done': 'done',
  'factory:archived': 'archived',
};

export const PRIORITY_COLOR: Record<string, string> = {
  critical: 'oklch(0.66 0.20 22)',
  high: 'oklch(0.74 0.15 50)',
  medium: 'oklch(0.78 0.14 78)',
  low: 'var(--fg-3)',
};

export const PRIORITY_BG: Record<string, string> = {
  critical: 'oklch(0.66 0.20 22 / 0.12)',
  high: 'oklch(0.74 0.15 50 / 0.12)',
  medium: 'oklch(0.78 0.14 78 / 0.12)',
  low: 'oklch(0.42 0.01 260 / 0.12)',
};

export const PRIORITY_BORDER: Record<string, string> = {
  critical: 'oklch(0.66 0.20 22 / 0.4)',
  high: 'oklch(0.74 0.15 50 / 0.4)',
  medium: 'oklch(0.78 0.14 78 / 0.4)',
  low: 'oklch(0.42 0.01 260 / 0.4)',
};

export const RETRO_ACTIVE_STATES = new Set(['factory:retrospecting', 'factory:done']);

export const CODE_ACTIVE_STATES = new Set([
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:retrospecting',
  'factory:done',
]);

// Placeholder shown wherever cost data will appear once M9 wires it through.
export const COST_PLACEHOLDER = '$—';

export const GATE_STATES: Record<string, string> = {
  'factory:prd-review': 'PRD Review pending — human approval required',
  'factory:needs-review': 'Code Review pending — human approval required',
  'factory:needs-human': 'Human intervention required',
};
