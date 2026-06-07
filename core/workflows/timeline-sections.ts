import { EVENT_KINDS, type EventKind } from '../event-stream/kinds.js';
import { WORKFLOW_CATALOG, type WorkflowGroup } from './workflow-catalog.js';

export const TIMELINE_SECTION_DEFINITIONS = [
  { id: 'triage', title: 'Triage' },
  { id: 'grounding', title: 'Grounding' },
  { id: 'investigation', title: 'Investigation' },
  { id: 'grill', title: 'Grill' },
  { id: 'prd', title: 'PRD' },
  { id: 'decompose', title: 'Decompose' },
  { id: 'delivery-router', title: 'Delivery Router' },
  { id: 'implementation', title: 'Implementation' },
  { id: 'evidence', title: 'Evidence' },
  { id: 'dev-review', title: 'Dev Review' },
  { id: 'qa', title: 'QA' },
  { id: 'review', title: 'Review' },
  { id: 'conflict', title: 'Conflict' },
  { id: 'retro', title: 'Retro' },
  { id: 'transitions', title: 'Transitions' },
  { id: 'system', title: 'System' },
] as const;

export type TimelineSectionId = (typeof TIMELINE_SECTION_DEFINITIONS)[number]['id'];

export type TimelineSectionEventInput = {
  kind: string;
  runId?: string | null;
  payload?: unknown;
};

export type TimelineEventClassificationDecision =
  | 'direct'
  | 'runtime-inherits'
  | 'intentionally-system'
  | 'hidden';

export type TimelineRunMetadataIndex = Map<string, TimelineSectionId>;

const SECTION_IDS = new Set<TimelineSectionId>(
  TIMELINE_SECTION_DEFINITIONS.map((section) => section.id),
);

const WORKFLOW_GROUP_TO_TIMELINE_SECTION: Record<WorkflowGroup, TimelineSectionId> = {
  triage: 'triage',
  grounding: 'grounding',
  investigation: 'investigation',
  grill: 'grill',
  prd: 'prd',
  decompose: 'decompose',
  'delivery-router': 'delivery-router',
  implementation: 'implementation',
  'dev-review': 'dev-review',
  qa: 'qa',
  review: 'review',
  conflict: 'conflict',
  retro: 'retro',
  research: 'system',
  terminal: 'system',
};

const DIRECT_EVENT_KIND_SECTION: Record<string, TimelineSectionId> = {
  'dogfood.seed-applied': 'system',
  'agent.checkout-readiness': 'system',
  'agent.triage-complete': 'triage',
  'agent.repo-override': 'triage',
  'agent.investigation-complete': 'investigation',
  'feature.framed': 'grounding',
  'feature.grounding-enhanced': 'grounding',
  'feature.grounding-complete': 'grounding',
  'agent.feature-enhance-empty': 'grounding',
  'agent.investigation-context-injected': 'investigation',
  'agent.investigation-seed-built': 'investigation',
  'agent.investigation-seed-empty': 'investigation',
  'agent.bug-enhance-lazy': 'investigation',
  'agent.bug-enhance-empty': 'investigation',
  'agent.bug-enhance-hallucinated': 'investigation',
  'agent.bug-enhance-workspace-empty': 'investigation',
  'investigation.digest-applied': 'investigation',
  'agent.related-surface-manifest-created': 'investigation',
  'agent.discovery-budget-exceeded': 'investigation',
  'agent.wrong-surface-guard': 'investigation',
  'acceptance.contract-authored': 'delivery-router',
  'acceptance.contract-output-normalized': 'delivery-router',
  'acceptance.contract-validation-failed': 'delivery-router',
  'spec.completed': 'delivery-router',
  'spec.prd-context-attached': 'delivery-router',
  'spec.wp-issues-created': 'delivery-router',
  'workflow.route-selected': 'delivery-router',
  'workflow.route-confirmed': 'delivery-router',
  'workflow.route-escalation-proposed': 'delivery-router',
  'workflow.route-cap-applied': 'delivery-router',
  'agent.implement-complete': 'implementation',
  'agent.fix-feedback-complete': 'implementation',
  'agent.fix-feedback-skipped': 'implementation',
  'parallel-implement.wp-context-assembled': 'implementation',
  'parallel-implement.wp-persisted': 'implementation',
  'pr.opened': 'implementation',
  'decompose.completed': 'decompose',
  'evidence.no-spec-declared': 'evidence',
  'evidence.posted': 'evidence',
  'evidence.post-failed': 'evidence',
  'evidence.post-skipped': 'evidence',
  'evidence.playwright-ran': 'investigation',
  'evidence.playwright-repro-skipped': 'investigation',
  'merge.conflict': 'conflict',
  'merge.conflict-resolved': 'conflict',
  'merge.conflict-unresolvable': 'conflict',
  'merge-decision.completed': 'review',
  'pr.merged': 'retro',
  'retrospective.completed': 'retro',
  'coach.completed': 'retro',
  'coach.dispatch-triggered': 'retro',
  'coach.skipped-forbidden-target': 'retro',
  'coach.dispatch-failed': 'retro',
  'audit.completed': 'review',
  'audit.failed': 'review',
  'github.issue.opened': 'system',
  'github.label.changed': 'system',
  'github.label-mirror-warning': 'system',
};

const TRANSITION_EVENT_KINDS = new Set([
  'state.transitioned',
  'state.transition-deferred',
  'manual.action',
  'gate.awaiting-human',
  'gate.approved',
  'gate.rejected',
]);

export const RUNTIME_INHERIT_TIMELINE_EVENT_KINDS = new Set<string>([
  'agent.spawned',
  'agent.decision-summary',
  'agent.decision-summary-live',
  'agent.disclosure',
  'agent.terminated',
  'agent.log',
  'agent.run-started',
  'agent.run-completed',
  'agent.run-failed',
  'agent.budget-exceeded',
  'agent.tool-call',
  'agent.tool-intensity-anomaly',
  'agent.tool-result',
  'agent.runtime-advisory',
  'agent.redundant-read',
  'tool.stdout-truncated',
  'tool.timeout',
  'agent.fallback-triggered',
  'agent.path-normalized',
  'agent.output-repaired',
  'agent.output-repair-failed',
  'agent.output-fact-mismatch',
  'agent.contract-gate-blocked',
  'agent.retry-escalated',
  'agent.model-selected',
  'agent.verify-command',
  'agent.cancelled',
  'agent.run-aborted',
  'tool.violation',
  'symbol-index.lookup',
  'symbol-index.hints-used',
]);

const INTENTIONALLY_SYSTEM_EVENT_KINDS = new Set<string>([
  'github.issue.opened',
  'github.label.changed',
  'github.label-mirror-warning',
  'milestone.activated',
  'system.note',
  'project.budget-exceeded',
  'workflow.smoke-failed',
  'audit.autonomy-gate-fired',
]);

const HIDDEN_EVENT_KINDS = new Set<string>([
  'chat.user-message',
  'chat.agent-message',
  'chat.agent-thinking',
  'chat.tool-proposed',
  'chat.tool-approved',
  'chat.tool-rejected',
  'chat.tool-running',
  'chat.tool-completed',
  'chat.tool-failed',
  'chat.run-failed',
]);

const DIRECT_TIMELINE_EVENT_KINDS = new Set<string>([
  ...Object.keys(DIRECT_EVENT_KIND_SECTION),
  ...TRANSITION_EVENT_KINDS,
  'qa.structural-passed',
  'qa.structural-failed',
  'qa.functional-passed',
  'qa.functional-failed',
  'qa.regression-passed',
  'qa.regression-failed',
  'qa.workflow-started',
  'qa.workflow-completed',
  'qa.workflow-failed',
  'qa.workflow-aborted',
  'qa.preflight-started',
  'qa.preflight-step-started',
  'qa.preflight-step-completed',
  'qa.preflight-step-failed',
  'qa.preflight-completed',
  'qa.verification-summary-built',
  'qa.verification-blocked',
  'qa.completed',
  'qa.tier-disagreement',
  'review.completed',
  'review.wave-completed',
  'review.wave-failed',
  'review.converged',
  'review.escalated',
  'review.slot-completed',
  'grill.question-posted',
  'grill.completed',
  'grill.decision-crystallized',
  'prd.drafted',
  'prd.advisor-skipped',
  'prd.approved',
  'prd.rejected',
  'prd.revised',
  'prd.declined',
  'prd.lifecycle-routed',
  'swarm.heartbeat',
  'swarm.scout-completed',
  'swarm.scout-skipped',
  'swarm.scout-timeout',
  'swarm.scout-failed',
  'swarm.wave-completed',
  'swarm.wave-incomplete',
  'swarm.wave-halted',
  'parallel-implement.iteration-started',
  'parallel-implement.wp-started',
  'parallel-implement.wp-context-assembled',
  'parallel-implement.wp-committed',
  'parallel-implement.wp-failed',
  'parallel-implement.wp-loop-cap-hit',
  'parallel-implement.wp-terminal-blocked',
  'parallel-implement.wp-timeout',
  'parallel-implement.wp-commit-failed',
  'parallel-implement.exhausted',
  'dev-review.started',
  'dev-review.completed',
  'dev-review.failed',
  'dev-review.error',
  'dev-review.budget-skipped',
  'dev-review.response-started',
  'dev-review.response-completed',
  'dev-review.response-failed',
  'spec.completed',
  'spec.prd-context-attached',
  'spec.wp-issues-created',
  'decompose.completed',
  'repo-match.completed',
]);

export const TIMELINE_EVENT_CLASSIFICATION = Object.freeze(
  Object.fromEntries(
    EVENT_KINDS.flatMap((kind): [EventKind, TimelineEventClassificationDecision][] => {
      if (HIDDEN_EVENT_KINDS.has(kind)) return [[kind, 'hidden']];
      if (INTENTIONALLY_SYSTEM_EVENT_KINDS.has(kind)) return [[kind, 'intentionally-system']];
      if (RUNTIME_INHERIT_TIMELINE_EVENT_KINDS.has(kind)) return [[kind, 'runtime-inherits']];
      if (DIRECT_TIMELINE_EVENT_KINDS.has(kind)) return [[kind, 'direct']];
      return [];
    }),
  ) as Partial<Record<EventKind, TimelineEventClassificationDecision>>,
);

const skillToSection = buildSkillSectionMap();
const stateToSection = buildStateSectionMap();
const SKILL_SECTION_ALIASES = new Map<string, TimelineSectionId>([
  ['feature-grounding', 'grounding'],
  ['feature-enhance', 'grounding'],
  ['parallel-implement', 'implementation'],
  ['evidence-post', 'evidence'],
]);

export function isTimelineSectionId(value: unknown): value is TimelineSectionId {
  return typeof value === 'string' && SECTION_IDS.has(value as TimelineSectionId);
}

export function timelineSectionForSkill(
  skill: string | null | undefined,
): TimelineSectionId | null {
  if (skill == null || skill.trim() === '') return null;
  return SKILL_SECTION_ALIASES.get(skill) ?? skillToSection.get(skill) ?? null;
}

export function timelineSectionForState(
  state: string | null | undefined,
): TimelineSectionId | null {
  if (state == null || state.trim() === '') return null;
  return stateToSection.get(state) ?? null;
}

export function resolveTimelineSection(
  event: TimelineSectionEventInput,
  options: { runMetadata?: TimelineRunMetadataIndex } = {},
): TimelineSectionId {
  const payload = recordPayload(event.payload);
  const explicit = explicitTimelineSection(payload);
  if (explicit != null) return explicit;

  const skillSection = timelineSectionForSkill(readSkill(payload));
  const inheritedSection =
    event.runId == null ? null : (options.runMetadata?.get(event.runId) ?? null);
  if (RUNTIME_INHERIT_TIMELINE_EVENT_KINDS.has(event.kind)) {
    if (inheritedSection != null) return inheritedSection;
    if (skillSection != null) return skillSection;
  }

  if (skillSection != null) return skillSection;

  if (TRANSITION_EVENT_KINDS.has(event.kind)) return 'transitions';

  const exactSection = DIRECT_EVENT_KIND_SECTION[event.kind];
  if (exactSection != null) return exactSection;

  if (event.kind.startsWith('repo-match.')) return 'triage';
  if (event.kind.startsWith('investigation.')) return 'investigation';
  if (event.kind.startsWith('grill.')) return 'grill';
  if (event.kind.startsWith('prd.')) return 'prd';
  if (event.kind.startsWith('decompose.')) return 'decompose';
  if (event.kind.startsWith('swarm.')) return 'investigation';
  if (event.kind.startsWith('qa.')) return 'qa';
  if (event.kind.startsWith('review.')) return 'review';
  if (event.kind.startsWith('evidence.')) return 'evidence';
  if (event.kind.startsWith('dev-review.')) return 'dev-review';
  if (event.kind.startsWith('parallel-implement.')) return 'implementation';
  if (event.kind.startsWith('merge.')) return 'conflict';
  if (event.kind.startsWith('audit.')) return 'review';
  if (event.kind.startsWith('coach.')) return 'retro';

  const runIdSection = timelineSectionFromHistoricalRunId(event.runId);
  if (runIdSection != null) return runIdSection;

  return 'system';
}

export function resolveTimelineSectionFromEvents(
  events: TimelineSectionEventInput[],
): TimelineSectionId {
  const runMetadata = buildTimelineRunMetadataIndex(events);
  for (const event of events) {
    const section = resolveTimelineSection(event, { runMetadata });
    if (section !== 'system') return section;
  }
  return 'system';
}

export function buildTimelineRunMetadataIndex(
  events: TimelineSectionEventInput[],
): TimelineRunMetadataIndex {
  const index: TimelineRunMetadataIndex = new Map();

  for (const event of events) {
    if (event.runId == null || event.runId.trim() === '') continue;
    const section = timelineSectionFromRuntimeMetadata(event);
    if (section == null) continue;
    const existing = index.get(event.runId);
    if (existing == null || event.kind === 'agent.run-started') {
      index.set(event.runId, section);
    }
  }

  return index;
}

function buildSkillSectionMap(): Map<string, TimelineSectionId> {
  const sections = new Map<string, TimelineSectionId>();
  for (const entry of WORKFLOW_CATALOG) {
    const stagesByNode = new Map<string, TimelineSectionId>();
    for (const stage of entry.stages) {
      const section = WORKFLOW_GROUP_TO_TIMELINE_SECTION[stage.group];
      for (const nodeId of stage.nodes) stagesByNode.set(nodeId, section);
      for (const variant of stage.variants ?? []) {
        for (const nodeId of variant.nodes) stagesByNode.set(nodeId, section);
      }
      for (const branch of stage.branches ?? []) {
        for (const nodeId of branch.nodes) stagesByNode.set(nodeId, section);
      }
    }

    for (const node of entry.nodes) {
      if (node.skill == null) continue;
      const section =
        stagesByNode.get(node.id) ??
        (node.group == null ? null : WORKFLOW_GROUP_TO_TIMELINE_SECTION[node.group]);
      if (section != null && section !== 'system') sections.set(node.skill, section);
    }
  }
  return sections;
}

function buildStateSectionMap(): Map<string, TimelineSectionId> {
  const sections = new Map<string, TimelineSectionId>();
  for (const entry of WORKFLOW_CATALOG) {
    for (const node of entry.nodes) {
      if (node.state == null || node.group == null) continue;
      sections.set(node.state, WORKFLOW_GROUP_TO_TIMELINE_SECTION[node.group]);
    }
  }
  return sections;
}

function recordPayload(payload: unknown): Record<string, unknown> | null {
  return payload != null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : null;
}

function explicitTimelineSection(
  payload: Record<string, unknown> | null,
): TimelineSectionId | null {
  for (const key of ['timelineSection', 'workflowSection', 'factorySection']) {
    const value = payload?.[key];
    if (isTimelineSectionId(value)) return value;
  }
  return null;
}

function readSkill(payload: Record<string, unknown> | null): string | null {
  let fallbackSkill: string | null = null;
  for (const key of ['displaySkill', 'workflowSkill', 'skill', 'consumerSkill']) {
    const value = payload?.[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    if (fallbackSkill == null) fallbackSkill = value;
    if (timelineSectionForSkill(value) != null) return value;
  }
  return fallbackSkill;
}

function timelineSectionFromRuntimeMetadata(
  event: TimelineSectionEventInput,
): TimelineSectionId | null {
  const payload = recordPayload(event.payload);
  const explicit = explicitTimelineSection(payload);
  if (explicit != null) return explicit;
  return timelineSectionForSkill(readSkill(payload));
}

function timelineSectionFromHistoricalRunId(
  runId: string | null | undefined,
): TimelineSectionId | null {
  if (runId == null) return null;
  if (runId.includes(':scout:')) return 'investigation';
  if (runId.includes(':feature-enhance')) return 'grounding';
  if (runId.includes(':bug-enhance')) return 'investigation';
  if (runId.endsWith(':grill-me')) return 'grill';
  if (runId.endsWith(':write-prd') || runId.endsWith(':advise-on-prd')) return 'prd';
  if (runId.endsWith(':decompose-issues')) return 'decompose';
  if (runId.includes(':wp:')) return 'implementation';
  if (runId.includes(':dev-review')) return 'dev-review';
  return null;
}
