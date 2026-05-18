import type { StateName } from '../state-machine/states.js';
import type { Role } from '../types.js';

export type WorkflowKind = 'bug' | 'feature' | 'chore' | 'research';

export type WorkflowEdgeKind = 'primary' | 'optional' | 'retry' | 'summary';

export type WorkflowNode = {
  id: string;
  label: string;
  state?: StateName;
  skill?: string;
  role?: Role;
  notes?: string;
};

export type WorkflowEdge = {
  from: string;
  to: string;
  label?: string;
  condition?: string;
  kind?: WorkflowEdgeKind;
  /**
   * True when the edge is a UI summary or branch annotation rather than a
   * direct state-machine transition.
   */
  virtual?: boolean;
};

export type WorkflowCatalogEntry = {
  kind: WorkflowKind;
  title: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  normalPath: string[];
};

const stateNode = (id: string, label: string, state: StateName, notes?: string): WorkflowNode => ({
  id,
  label,
  state,
  notes,
});

const skillNode = (
  id: string,
  label: string,
  skill: string,
  role: Role,
  state: StateName,
  notes?: string,
): WorkflowNode => ({
  id,
  label,
  skill,
  role,
  state,
  notes,
});

const primary = (from: string, to: string, label?: string): WorkflowEdge => ({
  from,
  to,
  label,
  kind: 'primary',
});

const optional = (
  from: string,
  to: string,
  label: string,
  condition?: string,
  virtual = false,
): WorkflowEdge => ({
  from,
  to,
  label,
  condition,
  kind: 'optional',
  virtual,
});

const retry = (from: string, to: string, label: string): WorkflowEdge => ({
  from,
  to,
  label,
  kind: 'retry',
});

const summary = (from: string, to: string, label?: string): WorkflowEdge => ({
  from,
  to,
  label,
  kind: 'summary',
  virtual: true,
});

const triageNodes: WorkflowNode[] = [
  stateNode('triaging', 'Triage', 'factory:triaging'),
  stateNode('accepted', 'Accepted', 'factory:accepted'),
  skillNode('triage-skill', 'triage', 'triage', 'triager', 'factory:triaging'),
  skillNode('repo-match-skill', 'repo-match', 'repo-match', 'researcher', 'factory:triaging'),
];

const deliveryNodes: WorkflowNode[] = [
  stateNode('dev-ready', 'Dev ready', 'factory:dev-ready'),
  stateNode('spec-ready', 'Spec ready', 'factory:spec-ready', 'M19 parallel path only.'),
  stateNode('in-progress', 'In progress', 'factory:in-progress'),
  stateNode('needs-qa', 'QA', 'factory:needs-qa', 'Holdout gate.'),
  stateNode('qa-failed', 'QA failed', 'factory:qa-failed'),
  stateNode('needs-fix', 'Needs fix', 'factory:needs-fix'),
  stateNode('needs-review', 'Review', 'factory:needs-review', 'Holdout gate.'),
  stateNode('approved', 'Approved', 'factory:approved'),
  stateNode('merge-conflict', 'Conflict', 'factory:merge-conflict'),
  stateNode('retrospecting', 'Retro', 'factory:retrospecting'),
  stateNode('needs-human', 'Needs human', 'factory:needs-human'),
  stateNode('done', 'Done', 'factory:done'),
  skillNode(
    'advise-on-plan-skill',
    'advise-on-plan',
    'advise-on-plan',
    'researcher',
    'factory:dev-ready',
  ),
  skillNode('spec-author-skill', 'spec-author', 'spec-author', 'developer', 'factory:dev-ready'),
  skillNode('implement-skill', 'implement', 'implement', 'developer', 'factory:dev-ready'),
  skillNode(
    'implement-wp-skill',
    'implement-wp',
    'implement-wp',
    'developer',
    'factory:spec-ready',
  ),
  skillNode(
    'dev-review-skill',
    'dev-review',
    'dev-review',
    'dev-reviewer',
    'factory:in-progress',
    'Codex provider by default.',
  ),
  skillNode(
    'dev-review-response-skill',
    'dev-review-response',
    'dev-review-response',
    'developer',
    'factory:in-progress',
  ),
  skillNode(
    'evidence-post-skill',
    'evidence-post',
    'evidence-post',
    'developer',
    'factory:in-progress',
    'Best-effort evidence path.',
  ),
  skillNode('qa-skill', 'qa', 'qa', 'qa', 'factory:needs-qa', 'Holdout.'),
  skillNode('review-skill', 'review', 'review', 'reviewer', 'factory:needs-review', 'Holdout.'),
  skillNode(
    'resolve-conflict-skill',
    'resolve-conflict',
    'resolve-conflict',
    'developer',
    'factory:merge-conflict',
  ),
  skillNode(
    'retro-light-skill',
    'retrospective-light',
    'retrospective-light',
    'retrospector',
    'factory:retrospecting',
  ),
  skillNode(
    'retro-deep-skill',
    'retrospective-deep',
    'retrospective-deep',
    'retrospector',
    'factory:retrospecting',
  ),
];

const deliveryEdges: WorkflowEdge[] = [
  primary('dev-ready', 'in-progress'),
  optional('dev-ready', 'spec-ready', 'M19 spec-author', 'multi-agent pipeline enabled'),
  primary('spec-ready', 'in-progress'),
  primary('in-progress', 'needs-qa'),
  primary('needs-qa', 'needs-review', 'QA pass'),
  primary('needs-review', 'approved', 'Review approve'),
  primary('approved', 'retrospecting'),
  primary('retrospecting', 'done'),
  retry('needs-qa', 'qa-failed', 'QA fail'),
  retry('qa-failed', 'needs-fix', 'Queue repair'),
  retry('needs-review', 'needs-fix', 'Request changes'),
  retry('needs-fix', 'in-progress', 'Repair'),
  optional('approved', 'merge-conflict', 'Merge conflict'),
  optional('merge-conflict', 'retrospecting', 'Resolved'),
  optional('merge-conflict', 'needs-human', 'Cannot resolve'),
  optional('dev-ready', 'needs-human', 'Workflow failure'),
  optional('spec-ready', 'needs-human', 'Spec failure'),
  optional('in-progress', 'needs-human', 'Implementation failure'),
  optional('needs-qa', 'needs-human', 'QA escalation'),
  optional('qa-failed', 'needs-human', 'Retry cap'),
  optional('needs-review', 'needs-human', 'Reviewer escalation'),
  optional('needs-fix', 'needs-human', 'Repair escalation'),
  optional('approved', 'needs-human', 'Post-approval failure'),
  summary('dev-ready', 'advise-on-plan-skill', 'high/critical legacy advisor'),
  summary('dev-ready', 'spec-author-skill', 'parallel path'),
  summary('spec-author-skill', 'spec-ready'),
  summary('spec-ready', 'implement-wp-skill', 'parallel WPs'),
  summary('dev-ready', 'implement-skill', 'legacy dev path'),
  summary('in-progress', 'dev-review-skill', 'pre-QA advisor'),
  summary('dev-review-skill', 'dev-review-response-skill', 'one repair turn'),
  summary('in-progress', 'evidence-post-skill', 'best effort'),
  summary('needs-qa', 'qa-skill', 'holdout'),
  summary('needs-review', 'review-skill', 'holdout'),
  summary('merge-conflict', 'resolve-conflict-skill'),
  summary('retrospecting', 'retro-light-skill'),
  summary('retrospecting', 'retro-deep-skill'),
];

const bugEntry: WorkflowCatalogEntry = {
  kind: 'bug',
  title: 'Bug workflow',
  description:
    'Bug work is triaged, repo-matched, investigated, optionally reproduced in-browser, then shipped through implementation, QA, review, and retro.',
  nodes: [
    ...triageNodes,
    stateNode('investigating', 'Investigating', 'factory:investigating'),
    stateNode('investigation-complete', 'Investigation complete', 'factory:investigation-complete'),
    skillNode(
      'investigate-skill',
      'investigate',
      'investigate',
      'investigator',
      'factory:investigating',
    ),
    skillNode(
      'playwright-repro-skill',
      'playwright-repro',
      'playwright-repro',
      'investigator',
      'factory:investigating',
      'Optional for browser/UI bugs.',
    ),
    ...deliveryNodes,
  ],
  edges: [
    summary('triage-skill', 'repo-match-skill'),
    primary('triaging', 'accepted'),
    primary('accepted', 'investigating'),
    primary('investigating', 'investigation-complete'),
    primary('investigation-complete', 'dev-ready'),
    optional('investigating', 'needs-human', 'Investigation blocked'),
    summary('investigating', 'investigate-skill'),
    summary('investigating', 'playwright-repro-skill', 'browser repro'),
    ...deliveryEdges,
  ],
  normalPath: [
    'triaging',
    'accepted',
    'investigating',
    'investigation-complete',
    'dev-ready',
    'in-progress',
    'needs-qa',
    'needs-review',
    'approved',
    'retrospecting',
    'done',
  ],
};

const featureEntry: WorkflowCatalogEntry = {
  kind: 'feature',
  title: 'Feature workflow',
  description:
    'Fresh feature work enters discovery, turns into a PRD, decomposes into child issues, then each child ships through development, QA, review, and retro.',
  nodes: [
    ...triageNodes,
    stateNode('grilling', 'Grilling', 'factory:grilling'),
    stateNode('prd-drafting', 'PRD draft', 'factory:prd-drafting'),
    stateNode('prd-review', 'PRD review', 'factory:prd-review'),
    stateNode('decomposing', 'Decompose', 'factory:decomposing'),
    stateNode('issues-created', 'Child issues', 'factory:issues-created'),
    skillNode('grill-me-skill', 'grill-me', 'grill-me', 'griller', 'factory:grilling'),
    skillNode('write-prd-skill', 'write-prd', 'write-prd', 'prd-writer', 'factory:prd-drafting'),
    skillNode(
      'advise-on-prd-skill',
      'advise-on-prd',
      'advise-on-prd',
      'prd-writer',
      'factory:prd-review',
    ),
    skillNode(
      'decompose-issues-skill',
      'decompose-issues',
      'decompose-issues',
      'decomposer',
      'factory:decomposing',
    ),
    ...deliveryNodes,
  ],
  edges: [
    summary('triage-skill', 'repo-match-skill'),
    primary('triaging', 'accepted'),
    primary('accepted', 'grilling'),
    primary('grilling', 'prd-drafting'),
    primary('prd-drafting', 'prd-review'),
    primary('prd-review', 'decomposing'),
    primary('decomposing', 'issues-created'),
    primary('issues-created', 'dev-ready'),
    optional('issues-created', 'done', 'Parent complete'),
    summary('grilling', 'grill-me-skill'),
    summary('prd-drafting', 'write-prd-skill'),
    summary('prd-review', 'advise-on-prd-skill'),
    summary('decomposing', 'decompose-issues-skill'),
    ...deliveryEdges,
  ],
  normalPath: [
    'triaging',
    'accepted',
    'grilling',
    'prd-drafting',
    'prd-review',
    'decomposing',
    'issues-created',
    'dev-ready',
    'in-progress',
    'needs-qa',
    'needs-review',
    'approved',
    'retrospecting',
    'done',
  ],
};

const choreEntry: WorkflowCatalogEntry = {
  kind: 'chore',
  title: 'Chore workflow',
  description:
    'Chores skip discovery and investigation after triage/repo-match, then move directly into implementation, QA, review, and retro.',
  nodes: [...triageNodes, ...deliveryNodes],
  edges: [
    summary('triage-skill', 'repo-match-skill'),
    primary('triaging', 'accepted'),
    primary('accepted', 'dev-ready'),
    ...deliveryEdges,
  ],
  normalPath: [
    'triaging',
    'accepted',
    'dev-ready',
    'in-progress',
    'needs-qa',
    'needs-review',
    'approved',
    'retrospecting',
    'done',
  ],
};

const researchEntry: WorkflowCatalogEntry = {
  kind: 'research',
  title: 'Research workflow',
  description:
    'Research items are triaged and repo-matched, move through research-pending/research-complete, then either become dev-ready follow-up work or require a human follow-up.',
  nodes: [
    ...triageNodes,
    stateNode('research-pending', 'Research pending', 'factory:research-pending'),
    stateNode('research-complete', 'Research complete', 'factory:research-complete'),
    stateNode('dev-ready', 'Dev ready', 'factory:dev-ready'),
    stateNode('needs-human', 'Needs human', 'factory:needs-human'),
  ],
  edges: [
    summary('triage-skill', 'repo-match-skill'),
    primary('triaging', 'accepted'),
    primary('accepted', 'research-pending'),
    primary('research-pending', 'research-complete'),
    primary('research-complete', 'dev-ready'),
    optional(
      'research-complete',
      'needs-human',
      'Human follow-up',
      'research is not directly actionable',
      true,
    ),
  ],
  normalPath: ['triaging', 'accepted', 'research-pending', 'research-complete', 'dev-ready'],
};

export const WORKFLOW_CATALOG = Object.freeze([
  bugEntry,
  featureEntry,
  choreEntry,
  researchEntry,
] satisfies WorkflowCatalogEntry[]);

export function getWorkflowCatalog(kind: WorkflowKind): WorkflowCatalogEntry {
  const entry = WORKFLOW_CATALOG.find((candidate) => candidate.kind === kind);
  if (entry == null) {
    throw new Error(`Unknown workflow kind: ${kind}`);
  }
  return entry;
}
