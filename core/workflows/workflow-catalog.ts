import type { StateName } from '../state-machine/states.js';
import type { Role } from '../types.js';

export type WorkflowKind = 'bug' | 'feature' | 'chore' | 'research';

export type WorkflowEdgeKind = 'primary' | 'optional' | 'retry' | 'summary';
export type WorkflowGroup =
  | 'triage'
  | 'discovery'
  | 'investigation'
  | 'delivery'
  | 'dev-review'
  | 'qa'
  | 'review'
  | 'retro'
  | 'research'
  | 'terminal';
export type WorkflowMode =
  | 'always'
  | 'legacy'
  | 'multi-agent'
  | 'single-investigation'
  | 'swarm'
  | 'dev-review'
  | 'single-review'
  | 'convergent-review'
  | 'conditional';
export type WorkflowActivationSetting =
  | 'useInvestigationSwarm'
  | 'useMultiAgentPipeline'
  | 'devReview.enabled'
  | 'review.convergent'
  | 'workItem.simpleBug'
  | 'priority.highCritical'
  | 'playwrightRepro.enabled'
  | 'evidencePost.enabled';
export type WorkflowVisual = 'state' | 'skill' | 'gate' | 'fanout' | 'loop' | 'terminal';

export type WorkflowActivation = {
  setting: WorkflowActivationSetting;
  value?: boolean | string;
  label: string;
};

export type WorkflowNode = {
  id: string;
  label: string;
  state?: StateName;
  skill?: string;
  role?: Role;
  notes?: string;
  group?: WorkflowGroup;
  mode?: WorkflowMode;
  activation?: WorkflowActivation;
  visual?: WorkflowVisual;
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
  stages: WorkflowStage[];
};

export type WorkflowVariant = {
  id: string;
  title: string;
  description?: string;
  mode: WorkflowMode;
  activation?: WorkflowActivation;
  nodes: string[];
};

export type WorkflowBranch = {
  id: string;
  title: string;
  description?: string;
  kind: 'conditional' | 'retry' | 'failure';
  nodes: string[];
  activation?: WorkflowActivation;
};

export type WorkflowStage = {
  id: string;
  title: string;
  description?: string;
  group: WorkflowGroup;
  nodes: string[];
  variants?: WorkflowVariant[];
  branches?: WorkflowBranch[];
};

const activeWhen = (
  setting: WorkflowActivationSetting,
  value: boolean | string | undefined,
  label: string,
): WorkflowActivation => ({
  setting,
  value,
  label,
});

const stateNode = (
  id: string,
  label: string,
  state: StateName,
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  label,
  state,
  visual: 'state',
  ...overrides,
});

const skillNode = (
  id: string,
  label: string,
  skill: string,
  role: Role,
  state: StateName,
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  label,
  skill,
  role,
  state,
  visual: 'skill',
  ...overrides,
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
  stateNode('triaging', 'Triage', 'factory:triaging', { group: 'triage' }),
  stateNode('accepted', 'Accepted', 'factory:accepted', { group: 'triage' }),
  skillNode('triage-skill', 'triage', 'triage', 'triager', 'factory:triaging', {
    group: 'triage',
  }),
  skillNode('repo-match-skill', 'repo-match', 'repo-match', 'researcher', 'factory:triaging', {
    group: 'triage',
  }),
];

const deliveryNodes: WorkflowNode[] = [
  stateNode('dev-ready', 'Dev ready', 'factory:dev-ready', { group: 'delivery' }),
  stateNode('spec-ready', 'Spec ready', 'factory:spec-ready', {
    group: 'delivery',
    mode: 'multi-agent',
    activation: activeWhen('useMultiAgentPipeline', true, 'multi-agent pipeline enabled'),
    notes: 'M19 parallel path only.',
  }),
  stateNode('in-progress', 'In progress', 'factory:in-progress', { group: 'delivery' }),
  stateNode('needs-qa', 'QA', 'factory:needs-qa', {
    group: 'qa',
    visual: 'gate',
    notes: 'Holdout gate.',
  }),
  stateNode('qa-failed', 'QA failed', 'factory:qa-failed', { group: 'qa', visual: 'loop' }),
  stateNode('needs-fix', 'Needs fix', 'factory:needs-fix', {
    group: 'delivery',
    visual: 'loop',
  }),
  stateNode('needs-review', 'Review', 'factory:needs-review', {
    group: 'review',
    visual: 'gate',
    notes: 'Holdout gate.',
  }),
  stateNode('approved', 'Approved', 'factory:approved', { group: 'review' }),
  stateNode('merge-conflict', 'Conflict', 'factory:merge-conflict', {
    group: 'terminal',
    visual: 'loop',
  }),
  stateNode('retrospecting', 'Retro', 'factory:retrospecting', { group: 'retro' }),
  stateNode('needs-human', 'Needs human', 'factory:needs-human', {
    group: 'terminal',
    visual: 'terminal',
  }),
  stateNode('done', 'Done', 'factory:done', { group: 'terminal', visual: 'terminal' }),
  skillNode(
    'advise-on-plan-skill',
    'advise-on-plan',
    'advise-on-plan',
    'researcher',
    'factory:dev-ready',
    {
      group: 'delivery',
      mode: 'legacy',
      activation: activeWhen('priority.highCritical', true, 'high/critical legacy path'),
    },
  ),
  skillNode('spec-author-skill', 'spec-author', 'spec-author', 'developer', 'factory:dev-ready', {
    group: 'delivery',
    mode: 'multi-agent',
    activation: activeWhen('useMultiAgentPipeline', true, 'multi-agent pipeline enabled'),
  }),
  skillNode('implement-skill', 'implement', 'implement', 'developer', 'factory:dev-ready', {
    group: 'delivery',
    mode: 'legacy',
    activation: activeWhen('useMultiAgentPipeline', false, 'legacy delivery path'),
  }),
  skillNode(
    'implement-wp-skill',
    'implement-wp',
    'implement-wp',
    'developer',
    'factory:spec-ready',
    {
      group: 'delivery',
      mode: 'multi-agent',
      visual: 'fanout',
      activation: activeWhen('useMultiAgentPipeline', true, 'parallel work packages'),
    },
  ),
  skillNode('dev-review-skill', 'dev-review', 'dev-review', 'dev-reviewer', 'factory:in-progress', {
    group: 'dev-review',
    mode: 'dev-review',
    activation: activeWhen('devReview.enabled', true, 'dev-review advisor enabled'),
    notes: 'Codex provider by default. Advisor, not a holdout.',
  }),
  skillNode(
    'dev-review-response-skill',
    'dev-review-response',
    'dev-review-response',
    'developer',
    'factory:in-progress',
    {
      group: 'dev-review',
      mode: 'dev-review',
      visual: 'loop',
      activation: activeWhen('devReview.enabled', true, 'blockers trigger revision'),
    },
  ),
  skillNode(
    'evidence-post-skill',
    'evidence-post',
    'evidence-post',
    'developer',
    'factory:in-progress',
    {
      group: 'dev-review',
      mode: 'conditional',
      activation: activeWhen('evidencePost.enabled', true, 'best-effort evidence enabled'),
      notes: 'Best-effort evidence path.',
    },
  ),
  skillNode('qa-skill', 'qa', 'qa', 'qa', 'factory:needs-qa', {
    group: 'qa',
    visual: 'gate',
    notes: 'Holdout.',
  }),
  skillNode('review-skill', 'review', 'review', 'reviewer', 'factory:needs-review', {
    group: 'review',
    mode: 'single-review',
    visual: 'gate',
    notes: 'Holdout.',
  }),
  skillNode('review-slot-a-skill', 'review slot A', 'review', 'reviewer', 'factory:needs-review', {
    group: 'review',
    mode: 'convergent-review',
    visual: 'fanout',
    activation: activeWhen('review.convergent', true, 'multi-agent convergent review'),
    notes: 'First convergent reviewer slot.',
  }),
  skillNode('review-slot-b-skill', 'review slot B', 'review', 'reviewer', 'factory:needs-review', {
    group: 'review',
    mode: 'convergent-review',
    visual: 'fanout',
    activation: activeWhen('review.convergent', true, 'multi-agent convergent review'),
    notes: 'Second convergent reviewer slot.',
  }),
  skillNode(
    'resolve-conflict-skill',
    'resolve-conflict',
    'resolve-conflict',
    'developer',
    'factory:merge-conflict',
    { group: 'terminal', mode: 'conditional' },
  ),
  skillNode(
    'retro-light-skill',
    'retrospective-light',
    'retrospective-light',
    'retrospector',
    'factory:retrospecting',
    { group: 'retro' },
  ),
  skillNode(
    'retro-deep-skill',
    'retrospective-deep',
    'retrospective-deep',
    'retrospector',
    'factory:retrospecting',
    { group: 'retro', activation: activeWhen('priority.highCritical', true, 'deep retro trigger') },
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

const deliveryStages: WorkflowStage[] = [
  {
    id: 'delivery-router',
    title: 'Delivery router',
    description: 'Chooses legacy implementation or the M19 spec-author/parallel path.',
    group: 'delivery',
    nodes: ['dev-ready'],
    variants: [
      {
        id: 'legacy-delivery',
        title: 'Legacy implement',
        description: 'Single developer agent ships directly from dev-ready.',
        mode: 'legacy',
        activation: activeWhen('useMultiAgentPipeline', false, 'multi-agent pipeline off'),
        nodes: ['advise-on-plan-skill', 'implement-skill', 'in-progress'],
      },
      {
        id: 'multi-agent-delivery',
        title: 'Multi-agent pipeline',
        description: 'Spec author creates work packages, then builders run in parallel.',
        mode: 'multi-agent',
        activation: activeWhen('useMultiAgentPipeline', true, 'multi-agent pipeline on'),
        nodes: ['spec-author-skill', 'spec-ready', 'implement-wp-skill', 'in-progress'],
      },
    ],
  },
  {
    id: 'dev-review-advisor',
    title: 'Dev-review advisor',
    description: 'Optional Codex pre-QA read. Blockers loop back to a developer response turn.',
    group: 'dev-review',
    nodes: ['dev-review-skill'],
    variants: [
      {
        id: 'dev-review-loop',
        title: 'Advisor loop',
        description: 'Runs after work-package commits and before QA when enabled and triggered.',
        mode: 'dev-review',
        activation: activeWhen('devReview.enabled', true, 'dev-review advisor enabled'),
        nodes: ['dev-review-skill', 'dev-review-response-skill'],
      },
    ],
    branches: [
      {
        id: 'dev-review-blockers',
        title: 'Blockers found',
        description: 'Developer receives findings and gets a bounded revision turn.',
        kind: 'retry',
        nodes: ['dev-review-response-skill'],
        activation: activeWhen('devReview.enabled', true, 'bounded by maxRevisionTurns'),
      },
      {
        id: 'evidence-post',
        title: 'Evidence post',
        description: 'Best-effort post-implementation evidence path.',
        kind: 'conditional',
        nodes: ['evidence-post-skill'],
        activation: activeWhen('evidencePost.enabled', true, 'evidence post enabled'),
      },
    ],
  },
  {
    id: 'qa',
    title: 'QA holdout',
    description: 'QA independently verifies the PR and can return the item for repair.',
    group: 'qa',
    nodes: ['needs-qa', 'qa-skill'],
    branches: [
      {
        id: 'qa-fail',
        title: 'QA failed',
        description: 'Failed QA moves to needs-fix, then back to implementation.',
        kind: 'retry',
        nodes: ['qa-failed', 'needs-fix'],
      },
      {
        id: 'qa-escalation',
        title: 'QA escalation',
        description: 'Unclear or exhausted retries move to human follow-up.',
        kind: 'failure',
        nodes: ['needs-human'],
      },
    ],
  },
  {
    id: 'review',
    title: 'Review holdout',
    description: 'Review stays independent from dev-review findings and implementation reasoning.',
    group: 'review',
    nodes: ['needs-review'],
    variants: [
      {
        id: 'single-review',
        title: 'Single reviewer',
        mode: 'single-review',
        activation: activeWhen('review.convergent', false, 'multi-agent pipeline off'),
        nodes: ['review-skill', 'approved'],
      },
      {
        id: 'convergent-review',
        title: 'Convergent reviewers',
        description: 'Reviewer slots run independently, then a convergence gate decides.',
        mode: 'convergent-review',
        activation: activeWhen('review.convergent', true, 'multi-agent pipeline on'),
        nodes: ['review-slot-a-skill', 'review-slot-b-skill', 'approved'],
      },
    ],
    branches: [
      {
        id: 'review-needs-fix',
        title: 'Request changes',
        description: 'Review findings return to needs-fix, then implementation repairs.',
        kind: 'retry',
        nodes: ['needs-fix'],
      },
      {
        id: 'review-needs-human',
        title: 'Divergence or escalation',
        description: 'Conflicting reviewer verdicts or unclear criteria escalate to a human.',
        kind: 'failure',
        nodes: ['needs-human'],
      },
    ],
  },
  {
    id: 'retro',
    title: 'Retro',
    description: 'Approved work records a light or deep retrospective before done.',
    group: 'retro',
    nodes: ['retrospecting', 'retro-light-skill', 'retro-deep-skill', 'done'],
    branches: [
      {
        id: 'merge-conflict',
        title: 'Merge conflict',
        description: 'Post-approval merge conflict can run resolver or escalate.',
        kind: 'conditional',
        nodes: ['merge-conflict', 'resolve-conflict-skill', 'needs-human'],
      },
    ],
  },
];

const triageStage: WorkflowStage = {
  id: 'triage',
  title: 'Triage',
  description: 'Classify the work item and match it to a repository.',
  group: 'triage',
  nodes: ['triaging', 'triage-skill', 'repo-match-skill', 'accepted'],
};

const bugEntry: WorkflowCatalogEntry = {
  kind: 'bug',
  title: 'Bug workflow',
  description:
    'Bug work is triaged, repo-matched, investigated, optionally reproduced in-browser, then shipped through implementation, QA, review, and retro.',
  nodes: [
    ...triageNodes,
    stateNode('investigating', 'Investigating', 'factory:investigating', {
      group: 'investigation',
    }),
    stateNode(
      'investigation-complete',
      'Investigation complete',
      'factory:investigation-complete',
      {
        group: 'investigation',
      },
    ),
    skillNode(
      'investigate-skill',
      'investigate',
      'investigate',
      'investigator',
      'factory:investigating',
      { group: 'investigation', mode: 'single-investigation' },
    ),
    skillNode(
      'playwright-repro-skill',
      'playwright-repro',
      'playwright-repro',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'conditional',
        activation: activeWhen('playwrightRepro.enabled', true, 'browser repro enabled'),
        notes: 'Optional for browser/UI bugs.',
      },
    ),
    skillNode(
      'acceptance-contract-skill',
      'acceptance-contract',
      'acceptance-contract',
      'developer',
      'factory:investigation-complete',
      {
        group: 'delivery',
        mode: 'legacy',
        activation: activeWhen('useMultiAgentPipeline', false, 'legacy delivery path'),
        notes: 'Normalizes legacy issue-body acceptance criteria before implementation.',
      },
    ),
    skillNode(
      'scout-code-path-skill',
      'scout-code-path',
      'scout-code-path',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        visual: 'fanout',
        activation: activeWhen('useInvestigationSwarm', true, 'investigation swarm enabled'),
      },
    ),
    skillNode(
      'scout-dependency-skill',
      'scout-dependency',
      'scout-dependency',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        visual: 'fanout',
        activation: activeWhen('useInvestigationSwarm', true, 'investigation swarm enabled'),
      },
    ),
    skillNode(
      'scout-pattern-skill',
      'scout-pattern',
      'scout-pattern',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        visual: 'fanout',
        activation: activeWhen('useInvestigationSwarm', true, 'investigation swarm enabled'),
      },
    ),
    skillNode(
      'scout-schema-skill',
      'scout-schema',
      'scout-schema',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        visual: 'fanout',
        activation: activeWhen('useInvestigationSwarm', true, 'investigation swarm enabled'),
      },
    ),
    skillNode(
      'scout-test-inventory-skill',
      'scout-test-inventory',
      'scout-test-inventory',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        visual: 'fanout',
        activation: activeWhen('useInvestigationSwarm', true, 'investigation swarm enabled'),
      },
    ),
    skillNode(
      'scout-user-journey-skill',
      'scout-user-journey',
      'scout-user-journey',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        visual: 'fanout',
        activation: activeWhen('useInvestigationSwarm', true, 'investigation swarm enabled'),
      },
    ),
    skillNode(
      'wave2-interface-designer-skill',
      'wave2-interface-designer',
      'wave2-interface-designer',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        activation: activeWhen('useInvestigationSwarm', true, 'wave 2 enabled'),
      },
    ),
    skillNode(
      'wave2-risk-analyst-skill',
      'wave2-risk-analyst',
      'wave2-risk-analyst',
      'investigator',
      'factory:investigating',
      {
        group: 'investigation',
        mode: 'swarm',
        activation: activeWhen('useInvestigationSwarm', true, 'wave 2 enabled'),
      },
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
    summary('investigation-complete', 'acceptance-contract-skill', 'legacy contract'),
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
  stages: [
    triageStage,
    {
      id: 'investigation',
      title: 'Investigation',
      description: 'Bug work can run as a single investigator or a scout swarm with synthesis.',
      group: 'investigation',
      nodes: ['investigating', 'investigation-complete'],
      variants: [
        {
          id: 'single-investigation',
          title: 'Single investigator',
          mode: 'single-investigation',
          activation: activeWhen('useInvestigationSwarm', false, 'investigation swarm off'),
          nodes: ['investigate-skill', 'playwright-repro-skill', 'investigation-complete'],
        },
        {
          id: 'swarm-investigation',
          title: 'Scout swarm',
          description: 'Wave 1 scouts fan out, Wave 2 synthesizes, then investigate completes.',
          mode: 'swarm',
          activation: activeWhen('useInvestigationSwarm', true, 'investigation swarm on'),
          nodes: [
            'scout-code-path-skill',
            'scout-dependency-skill',
            'scout-pattern-skill',
            'scout-schema-skill',
            'scout-test-inventory-skill',
            'scout-user-journey-skill',
            'wave2-interface-designer-skill',
            'wave2-risk-analyst-skill',
            'investigate-skill',
            'investigation-complete',
          ],
        },
      ],
      branches: [
        {
          id: 'investigation-blocked',
          title: 'Investigation blocked',
          kind: 'failure',
          nodes: ['needs-human'],
        },
      ],
    },
    {
      ...deliveryStages[0],
      nodes: ['acceptance-contract-skill', ...deliveryStages[0].nodes],
      variants: deliveryStages[0].variants?.map((variant) =>
        variant.id === 'legacy-delivery'
          ? {
              ...variant,
              description:
                'Acceptance contract normalizes criteria, then a single developer agent ships directly from dev-ready.',
              nodes: ['acceptance-contract-skill', ...variant.nodes],
            }
          : variant,
      ),
      branches: [
        {
          id: 'simple-bug-legacy',
          title: 'Simple high-confidence bug',
          description:
            'Even with the multi-agent pipeline enabled, simple high-confidence bugs can route to legacy implement.',
          kind: 'conditional',
          nodes: ['acceptance-contract-skill', 'implement-skill'],
          activation: activeWhen('workItem.simpleBug', true, 'simple high-confidence bug'),
        },
      ],
    },
    ...deliveryStages.slice(1),
  ],
};

const featureEntry: WorkflowCatalogEntry = {
  kind: 'feature',
  title: 'Feature workflow',
  description:
    'Fresh feature work enters discovery, turns into a PRD, decomposes into child issues, then each child ships through development, QA, review, and retro.',
  nodes: [
    ...triageNodes,
    stateNode('grilling', 'Grilling', 'factory:grilling', { group: 'discovery' }),
    stateNode('prd-drafting', 'PRD draft', 'factory:prd-drafting', { group: 'discovery' }),
    stateNode('prd-review', 'PRD review', 'factory:prd-review', { group: 'discovery' }),
    stateNode('decomposing', 'Decompose', 'factory:decomposing', { group: 'discovery' }),
    stateNode('issues-created', 'Child issues', 'factory:issues-created', {
      group: 'discovery',
    }),
    skillNode('grill-me-skill', 'grill-me', 'grill-me', 'griller', 'factory:grilling', {
      group: 'discovery',
    }),
    skillNode('write-prd-skill', 'write-prd', 'write-prd', 'prd-writer', 'factory:prd-drafting', {
      group: 'discovery',
    }),
    skillNode(
      'advise-on-prd-skill',
      'advise-on-prd',
      'advise-on-prd',
      'prd-writer',
      'factory:prd-review',
      { group: 'discovery' },
    ),
    skillNode(
      'decompose-issues-skill',
      'decompose-issues',
      'decompose-issues',
      'decomposer',
      'factory:decomposing',
      { group: 'discovery' },
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
  stages: [
    triageStage,
    {
      id: 'feature-discovery',
      title: 'Discovery',
      description: 'Fresh features are grilled, written into a PRD, advised, and decomposed.',
      group: 'discovery',
      nodes: [
        'grilling',
        'grill-me-skill',
        'prd-drafting',
        'write-prd-skill',
        'prd-review',
        'advise-on-prd-skill',
        'decomposing',
        'decompose-issues-skill',
        'issues-created',
      ],
    },
    ...deliveryStages,
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
  stages: [triageStage, ...deliveryStages],
};

const researchEntry: WorkflowCatalogEntry = {
  kind: 'research',
  title: 'Research workflow',
  description:
    'Research items are triaged and repo-matched, move through research-pending/research-complete, then either become dev-ready follow-up work or require a human follow-up.',
  nodes: [
    ...triageNodes,
    stateNode('research-pending', 'Research pending', 'factory:research-pending', {
      group: 'research',
    }),
    stateNode('research-complete', 'Research complete', 'factory:research-complete', {
      group: 'research',
    }),
    stateNode('dev-ready', 'Dev ready', 'factory:dev-ready', { group: 'delivery' }),
    stateNode('needs-human', 'Needs human', 'factory:needs-human', {
      group: 'terminal',
      visual: 'terminal',
    }),
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
  stages: [
    triageStage,
    {
      id: 'research',
      title: 'Research',
      description: 'Research moves from pending to complete, then becomes follow-up work.',
      group: 'research',
      nodes: ['research-pending', 'research-complete'],
      branches: [
        {
          id: 'human-follow-up',
          title: 'Human follow-up',
          description: 'Research that is not directly actionable lands with a human.',
          kind: 'conditional',
          nodes: ['needs-human'],
        },
      ],
    },
    {
      id: 'research-outcome',
      title: 'Outcome',
      description: 'Actionable research can become development-ready follow-up work.',
      group: 'delivery',
      nodes: ['dev-ready'],
    },
  ],
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
