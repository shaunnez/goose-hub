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
  'factory:merge-conflict': 'merge-conflict',
  'factory:retrospecting': 'retrospecting',
  'factory:needs-human': 'needs-human',
  'factory:done': 'done',
  'factory:archived': 'archived',
  'factory:gate-pending': 'gate-pending',
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

// PRD tab is visible across the discover lane after grilling — drafting,
// review, and the post-approval decompose / issues-created stages so the
// user can scroll back to the most recent PRD draft.
export const PRD_ACTIVE_STATES = new Set([
  'factory:prd-drafting',
  'factory:prd-review',
  'factory:decomposing',
  'factory:issues-created',
]);

// Grill tab is visible on issues that are currently in (or recently came from)
// the discover lane. Hidden entirely on issues that never went through grill,
// so triage / dev-ready / coding etc. don't see a Grill tab.
export const GRILL_ACTIVE_STATES = new Set([
  'factory:grilling',
  'factory:gate-pending',
  'factory:prd-drafting',
  'factory:prd-review',
]);

export const CODE_ACTIVE_STATES = new Set([
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:merge-conflict',
  'factory:retrospecting',
  'factory:done',
]);

export const GATE_STATES: Record<string, string> = {
  'factory:prd-review': 'PRD Review pending — human approval required',
  'factory:needs-review': 'Code Review pending — human approval required',
  'factory:needs-human': 'Human intervention required',
};

export const PENDING_NEXT_RUN_STATES: Record<string, string> = {
  'factory:triaging': 'triage',
  'factory:grilling': 'grill-me',
  'factory:prd-drafting': 'write-prd',
  'factory:decomposing': 'decompose-issues',
  'factory:dev-ready': 'implement',
  'factory:in-progress': 'implement',
  'factory:needs-qa': 'qa',
  'factory:needs-fix': 'fix-issue',
  'factory:retrospecting': 'retrospective',
};
