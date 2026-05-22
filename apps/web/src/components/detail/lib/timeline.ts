import type { AgentEventDto, CostRowDto, InterventionDto, InterventionEventDto } from '@/lib/types';
import {
  TIMELINE_SECTION_DEFINITIONS,
  type TimelineSectionId,
  buildTimelineRunMetadataIndex,
  resolveTimelineSection,
} from '@goose-hub/core/workflows/timeline-sections.js';
import { GRILL_REPLY_MARKER } from './grill-comments';

export type TimelineContext = {
  slug: string;
  issueId: string;
  latestRunId: string | null;
  runCosts?: Map<string, CostRowDto>;
  /** Monotonic tick that increments each time the user clicks expand/collapse all. */
  expandSignal?: { tick: number; open: boolean };
};

export type InterventionTimelineDetail = {
  intervention: InterventionDto;
  events: InterventionEventDto[];
};

// ─── display helpers ──────────────────────────────────────────────────────────

/**
 * Maps event-kind strings (`agent.run-started`, `state.transitioned`, …) to
 * human-readable labels. This is only a label registry; timeline subscription
 * and visibility are governed by @goose-hub/core/event-stream/issue-timeline.
 *
 * NOTE: this is event-kind labelling. `STATE_LABEL` in `@/lib/constants`
 * separately maps `factory:*` work-item state names; keep them apart.
 */

export const EVENT_KIND_LABEL: Record<string, string> = {
  'state.transitioned': 'State transitioned',
  'milestone.activated': 'Milestone activated',
  'agent.spawned': 'Agent spawned',
  'agent.decision-summary': 'Decision summary',
  'agent.decision-summary-live': 'Decision (live)',
  'agent.disclosure': 'Input summarized',
  'agent.terminated': 'Agent terminated',
  'agent.log': 'Agent log',
  'gate.awaiting-human': 'Gate — awaiting human',
  'system.note': 'Note',
  'manual.action': 'Manual action',
  'agent.run-started': 'Agent run started',
  'agent.run-completed': 'Agent run completed',
  'agent.run-failed': 'Agent run failed',
  'agent.budget-exceeded': 'Agent budget exceeded',
  'agent.tool-call': 'Tool call',
  'agent.tool-result': 'Tool result (error)',
  'tool.stdout-truncated': 'Stdout truncated',
  'tool.timeout': 'Timeout',
  'agent.fallback-triggered': 'Fallback triggered',
  'agent.triage-complete': 'Triage complete',
  'agent.investigation-complete': 'Investigation complete',
  'agent.investigation-context-injected': 'Investigation context injected',
  'agent.related-surface-manifest-created': 'Related surface manifest',
  'agent.discovery-budget-exceeded': 'Discovery budget exceeded',
  'agent.wrong-surface-guard': 'Wrong surface guard',
  'agent.path-normalized': 'Path normalized',
  'agent.output-repaired': 'Output repaired',
  'agent.output-repair-failed': 'Output repair failed',
  'agent.output-fact-mismatch': 'Output fact mismatch',
  'agent.contract-gate-blocked': 'Contract gate blocked',
  'acceptance.contract-authored': 'Acceptance contract authored',
  'symbol-index.lookup': 'Symbol index lookup',
  'symbol-index.hints-used': 'Symbol hints used',
  'agent.implement-complete': 'Implement complete',
  'agent.fix-feedback-complete': 'Fix feedback complete',
  'agent.retry-escalated': 'Retry escalated',
  'pr.opened': 'PR opened',
  'pr.merged': 'PR merged',
  'gate.approved': 'Gate approved',
  'gate.rejected': 'Gate rejected',
  'review.completed': 'Review completed',
  'review.wave-completed': 'Review wave completed',
  'review.wave-failed': 'Review wave failed',
  'review.converged': 'Review converged',
  'review.escalated': 'Review escalated',
  'review.slot-completed': 'Review slot completed',
  'evidence.no-spec-declared': 'Evidence — no spec declared',
  'evidence.playwright-repro-skipped': 'Playwright repro skipped',
  'evidence.playwright-ran': 'Playwright evidence ran',
  'evidence.posted': 'Evidence posted',
  'evidence.post-skipped': 'Evidence post skipped',
  'evidence.post-failed': 'Evidence post failed',
  'agent.verify-command': 'Verify command',
  'qa.completed': 'QA completed',
  'qa.structural-passed': 'QA structural passed',
  'qa.structural-failed': 'QA structural failed',
  'qa.functional-passed': 'QA functional passed',
  'qa.functional-failed': 'QA functional failed',
  'qa.regression-passed': 'QA regression passed',
  'qa.regression-failed': 'QA regression failed',
  'qa.verification-summary-built': 'QA verification summary built',
  'qa.verification-blocked': 'QA verification blocked',
  'retrospective.completed': 'Retrospective completed',
  'grill.question-posted': 'Grill question posted',
  'grill.completed': 'Grill completed',
  'grill.decision-crystallized': 'Grill decision crystallized',
  'prd.drafted': 'PRD drafted',
  'prd.advisor-skipped': 'Advisor skipped',
  'prd.approved': 'PRD approved',
  'prd.rejected': 'PRD rejected',
  'prd.revised': 'PRD revision requested',
  'prd.declined': 'Feature declined',
  'prd.lifecycle-routed': 'PRD lifecycle routed',
  'decompose.completed': 'Decompose complete',
  'spec.completed': 'Spec authored',
  'spec.prd-context-attached': 'PRD context attached',
  'spec.wp-issues-created': 'WP tracking issues created',
  'agent.model-selected': 'Model selected',
  'swarm.heartbeat': 'Swarm heartbeat',
  'swarm.scout-completed': 'Scout completed',
  'swarm.scout-failed': 'Scout failed',
  'swarm.scout-timeout': 'Scout timeout',
  'swarm.wave-completed': 'Wave completed',
  'swarm.wave-halted': 'Wave halted',
  'swarm.wave-incomplete': 'Wave incomplete',
  'parallel-implement.iteration-started': 'Parallel iteration started',
  'parallel-implement.wp-started': 'Work package started',
  'parallel-implement.wp-committed': 'Work package committed',
  'parallel-implement.wp-failed': 'Work package failed',
  'parallel-implement.wp-timeout': 'Work package timed out',
  'parallel-implement.wp-commit-failed': 'Work package commit failed',
  'parallel-implement.exhausted': 'Parallel implement exhausted',
  'dev-review.started': 'Dev review started',
  'dev-review.completed': 'Dev review completed',
  'dev-review.failed': 'Dev review failed',
  'dev-review.error': 'Dev review error',
  'dev-review.budget-skipped': 'Dev review budget skipped',
  'dev-review.response-started': 'Dev review response started',
  'dev-review.response-completed': 'Dev review response completed',
  'dev-review.response-failed': 'Dev review response failed',
};

export function formatSkillName(skill: string | null): string {
  if (skill == null) return '(Unknown)';
  if (skill === 'qa') return 'QA';
  return skill
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function getPayloadStr(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

const CODEX_STDIN_BANNER = 'Reading additional input from stdin...';

type AgentLogPayload = {
  line?: string;
  metric?: string;
  stream?: string;
  text?: string;
};

function stripCodexStdinBanner(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => line !== CODEX_STDIN_BANNER)
    .join('\n')
    .trim();
}

export function normalizeAgentLogEvent(event: AgentEventDto): AgentEventDto | null {
  if (event.kind !== 'agent.log') return event;

  const payload = event.payload as AgentLogPayload | null;
  if (payload?.stream === 'telemetry' && payload.metric === 'prompt_context_size') return null;
  if (payload?.stream !== 'stderr') return event;

  const nextPayload = { ...payload };
  let changed = false;

  if (typeof payload.text === 'string') {
    nextPayload.text = stripCodexStdinBanner(payload.text);
    changed = changed || nextPayload.text !== payload.text;
  }
  if (typeof payload.line === 'string') {
    nextPayload.line = stripCodexStdinBanner(payload.line);
    changed = changed || nextPayload.line !== payload.line;
  }

  if (nextPayload.text === '' && nextPayload.line === '') return null;
  if (nextPayload.text === '' && nextPayload.line == null) return null;
  if (nextPayload.line === '' && nextPayload.text == null) return null;

  return changed ? { ...event, payload: nextPayload } : event;
}

export function getAgentLogDisplayText(event: AgentEventDto): string {
  const normalized = normalizeAgentLogEvent(event) ?? event;
  const payload = normalized.payload as AgentLogPayload | null;
  if (payload?.line != null && (payload.line !== '' || payload.text == null)) return payload.line;
  if (payload?.text != null) return payload.text;
  return getPayloadStr(normalized.payload);
}

export function isCodexTransportWarningLog(event: AgentEventDto): boolean {
  if (event.kind !== 'agent.log') return false;
  const payload = event.payload as AgentLogPayload | null;
  if (payload?.stream !== 'stderr') return false;

  const detail = JSON.stringify(event.payload ?? {});
  const lowerDetail = detail.toLowerCase();
  return (
    lowerDetail.includes('responses_websocket') &&
    lowerDetail.includes('failed to connect to websocket') &&
    lowerDetail.includes('503 service unavailable')
  );
}

function isGrillReplyManualAction(event: AgentEventDto): boolean {
  if (event.kind !== 'manual.action') return false;
  const payload = event.payload as { preview?: unknown } | null;
  return typeof payload?.preview === 'string' && payload.preview.startsWith(GRILL_REPLY_MARKER);
}

// ─── grouping ────────────────────────────────────────────────────────────────

export type RenderItem =
  | { kind: 'event'; event: AgentEventDto }
  | { kind: 'log-group'; events: AgentEventDto[] }
  | {
      kind: 'timeline-section';
      segmentId: string;
      section: TimelineSectionId;
      items: RenderItem[];
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'intervention-group';
      intervention: InterventionDto;
      events: InterventionEventDto[];
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'run-group';
      runId: string;
      items: RenderItem[];
      skill: string | null;
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
      personaId: string | null;
      modelId: string | null;
      runtime: string | null;
    }
  | {
      kind: 'investigation-phase';
      investigationRunId: string;
      items: RenderItem[];
      status: 'started' | 'live' | 'completed' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'phase-group';
      phase: 'grill' | 'prd' | 'contract' | 'dev';
      pipelineRunId: string;
      idKind: 'session' | 'workflow' | 'contract' | 'pipeline';
      items: RenderItem[];
      status: 'started' | 'live' | 'completed' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'review-group';
      reviewWorkflowRunId: string;
      items: RenderItem[];
      status: 'live' | 'completed' | 'needs-human' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    };

/**
 * Pre-processes an events array for rendering.
 * - Consecutive `agent.log` events (4+) → collapsible log-group
 * - Events sharing the same runId are grouped into a run-group
 */
function effectiveTimestamp(item: RenderItem): number {
  if (item.kind === 'intervention-group') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'run-group') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'timeline-section') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'investigation-phase') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'event') return new Date(item.event.createdAt).getTime();
  if (item.kind === 'phase-group') return new Date(item.startedAt ?? 0).getTime();
  if (item.kind === 'review-group') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  return new Date(item.events[0]?.createdAt ?? 0).getTime();
}

function optionalTimestamp(value: string | null): number {
  return value == null ? 0 : new Date(value).getTime();
}

function compareRenderItems(a: RenderItem, b: RenderItem): number {
  const activityDelta = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (activityDelta !== 0) return activityDelta;

  if (a.kind === 'run-group' && b.kind === 'run-group') {
    const startedDelta = optionalTimestamp(a.startedAt) - optionalTimestamp(b.startedAt);
    if (startedDelta !== 0) return startedDelta;
    return a.runId.localeCompare(b.runId);
  }

  return 0;
}

function getDiscoverSessionId(event: AgentEventDto): string | null {
  const payload = event.payload as { discoverSessionId?: unknown } | null;
  if (typeof payload?.discoverSessionId === 'string' && payload.discoverSessionId.trim() !== '') {
    return payload.discoverSessionId;
  }
  return null;
}

function getWorkflowRunId(event: AgentEventDto): string | null {
  const payload = event.payload as { workflowRunId?: unknown } | null;
  if (typeof payload?.workflowRunId === 'string' && payload.workflowRunId.trim() !== '') {
    return payload.workflowRunId;
  }
  return event.runId ?? null;
}

type DiscoverSessionRunIndex = ReadonlyMap<string, string>;

function discoverIndexKey(kind: 'run' | 'workflow', id: string): string {
  return `${kind}:${id}`;
}

function getDiscoverPhaseId(
  event: AgentEventDto,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex = new Map(),
): { id: string; idKind: 'session' | 'workflow' } | null {
  const discoverSessionId = getDiscoverSessionId(event);
  if (discoverSessionId != null) return { id: discoverSessionId, idKind: 'session' };
  const workflowRunId = getWorkflowRunId(event);
  if (workflowRunId != null) {
    const sessionId = discoverSessionByWorkflowOrRunId.get(
      discoverIndexKey('workflow', workflowRunId),
    );
    if (sessionId != null) return { id: sessionId, idKind: 'session' };
  }
  if (event.runId != null) {
    const sessionId = discoverSessionByWorkflowOrRunId.get(discoverIndexKey('run', event.runId));
    if (sessionId != null) return { id: sessionId, idKind: 'session' };
  }
  return workflowRunId != null ? { id: workflowRunId, idKind: 'workflow' } : null;
}

function isGrillPhaseEvent(event: AgentEventDto): boolean {
  if (event.kind.startsWith('grill.')) return true;
  if (event.kind !== 'state.transitioned' || getDiscoverSessionId(event) == null) return false;
  const payload = event.payload as { from?: unknown; to?: unknown } | null;
  return payload?.from === 'factory:gate-pending' && payload.to === 'factory:grilling';
}

function isPrdPhaseEvent(event: AgentEventDto): boolean {
  return event.kind.startsWith('prd.');
}

function resolveDiscoverPhaseStatus(
  phase: 'grill' | 'prd',
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  if (events.some((event) => event.kind === 'agent.run-failed')) return 'failed';
  if (phase === 'grill') {
    if (events.some((event) => event.kind === 'grill.completed')) return 'completed';
    if (events.some((event) => event.kind === 'grill.question-posted')) return 'completed';
  } else if (
    events.some((event) =>
      ['prd.drafted', 'prd.approved', 'prd.rejected', 'prd.revised', 'prd.declined'].includes(
        event.kind,
      ),
    )
  ) {
    return 'completed';
  }
  return items.some(hasLiveRunGroup) ? 'live' : 'started';
}

function appendDiscoverPhaseItem(
  phaseItems: Map<
    string,
    { id: string; idKind: 'session' | 'workflow'; grill: RenderItem[]; prd: RenderItem[] }
  >,
  phaseId: { id: string; idKind: 'session' | 'workflow' },
  phase: 'grill' | 'prd',
  item: RenderItem,
): void {
  const key = `${phaseId.idKind}:${phaseId.id}`;
  const group = phaseItems.get(key) ?? { ...phaseId, grill: [], prd: [] };
  group[phase].push(item);
  phaseItems.set(key, group);
}

function discoverSessionIdFromUnknown(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.discoverSessionId === 'string' && record.discoverSessionId.trim() !== '') {
    return record.discoverSessionId;
  }
  for (const key of ['evidence', 'actionPayload', 'result', 'verification']) {
    const nested = discoverSessionIdFromUnknown(record[key]);
    if (nested != null) return nested;
  }
  return null;
}

function interventionDiscoverSessionId(
  item: Extract<RenderItem, { kind: 'intervention-group' }>,
): string | null {
  if (item.intervention.interventionType !== 'manual_override') return null;
  for (const value of [
    item.intervention.decidedActionPayload,
    item.intervention.applicationResult,
    item.intervention.verification,
    ...item.events.map((event) => event.payload),
  ]) {
    const discoverSessionId = discoverSessionIdFromUnknown(value);
    if (discoverSessionId != null) return discoverSessionId;
  }
  return null;
}

function childDiscoverPhase(
  item: RenderItem,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex = new Map(),
): { id: string; idKind: 'session' | 'workflow'; phase: 'grill' | 'prd' } | null {
  if (item.kind === 'intervention-group') {
    const discoverSessionId = interventionDiscoverSessionId(item);
    if (discoverSessionId != null) {
      return { id: discoverSessionId, idKind: 'session', phase: 'grill' };
    }
    return null;
  }
  if (item.kind !== 'run-group') return null;
  for (const event of eventFromRenderItem(item)) {
    const phaseId = getDiscoverPhaseId(event, discoverSessionByWorkflowOrRunId);
    if (phaseId == null) continue;
    const payload = event.payload as { skill?: string } | null;
    if (payload?.skill === 'grill-me') return { ...phaseId, phase: 'grill' };
    if (payload?.skill === 'write-prd' || payload?.skill === 'advise-on-prd') {
      return { ...phaseId, phase: 'prd' };
    }
  }
  if (item.runId.endsWith(':grill-me')) {
    return {
      id: item.runId.slice(0, -':grill-me'.length),
      idKind: 'workflow',
      phase: 'grill',
    };
  }
  if (item.runId.endsWith(':write-prd')) {
    return {
      id: item.runId.slice(0, -':write-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  if (item.runId.endsWith(':advise-on-prd')) {
    return {
      id: item.runId.slice(0, -':advise-on-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  return null;
}

function eventDiscoverPhase(
  event: AgentEventDto,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex = new Map(),
): { id: string; idKind: 'session' | 'workflow'; phase: 'grill' | 'prd' } | null {
  const phaseId = getDiscoverPhaseId(event, discoverSessionByWorkflowOrRunId);
  const payload = event.payload as { skill?: string } | null;
  if (phaseId != null) {
    if (payload?.skill === 'grill-me') return { ...phaseId, phase: 'grill' };
    if (payload?.skill === 'write-prd' || payload?.skill === 'advise-on-prd') {
      return { ...phaseId, phase: 'prd' };
    }
  }
  if (event.runId?.endsWith(':grill-me')) {
    return {
      id: event.runId.slice(0, -':grill-me'.length),
      idKind: 'workflow',
      phase: 'grill',
    };
  }
  if (event.runId?.endsWith(':write-prd')) {
    return {
      id: event.runId.slice(0, -':write-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  if (event.runId?.endsWith(':advise-on-prd')) {
    return {
      id: event.runId.slice(0, -':advise-on-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  return null;
}

export function groupByDiscoverPhase(items: RenderItem[]): RenderItem[] {
  return groupByDiscoverPhaseWithSessionIndex(items, new Map());
}

function groupByDiscoverPhaseWithSessionIndex(
  items: RenderItem[],
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex,
): RenderItem[] {
  const phaseItems = new Map<
    string,
    { id: string; idKind: 'session' | 'workflow'; grill: RenderItem[]; prd: RenderItem[] }
  >();
  const ungrouped: RenderItem[] = [];

  for (const item of items) {
    const childPhase = childDiscoverPhase(item, discoverSessionByWorkflowOrRunId);
    if (childPhase != null) {
      appendDiscoverPhaseItem(phaseItems, childPhase, childPhase.phase, item);
      continue;
    }

    if (item.kind === 'event') {
      const runtimePhase = eventDiscoverPhase(item.event, discoverSessionByWorkflowOrRunId);
      if (runtimePhase != null) {
        appendDiscoverPhaseItem(phaseItems, runtimePhase, runtimePhase.phase, item);
        continue;
      }
      const phaseId = getDiscoverPhaseId(item.event, discoverSessionByWorkflowOrRunId);
      if (phaseId != null && isGrillPhaseEvent(item.event)) {
        appendDiscoverPhaseItem(phaseItems, phaseId, 'grill', item);
        continue;
      }
      if (phaseId != null && isPrdPhaseEvent(item.event)) {
        appendDiscoverPhaseItem(phaseItems, phaseId, 'prd', item);
        continue;
      }
      ungrouped.push(item);
      continue;
    }

    if (item.kind === 'run-group') {
      const remaining: RenderItem[] = [];
      let consumedDiscoverPhase: 'grill' | 'prd' | null = null;
      for (const event of eventFromRenderItem(item)) {
        const phaseId = getDiscoverPhaseId(event, discoverSessionByWorkflowOrRunId);
        if (phaseId != null && isGrillPhaseEvent(event)) {
          appendDiscoverPhaseItem(phaseItems, phaseId, 'grill', { kind: 'event', event });
          consumedDiscoverPhase = 'grill';
        } else if (phaseId != null && isPrdPhaseEvent(event)) {
          appendDiscoverPhaseItem(phaseItems, phaseId, 'prd', { kind: 'event', event });
          consumedDiscoverPhase = 'prd';
        } else {
          remaining.push({ kind: 'event', event });
        }
      }
      if (consumedDiscoverPhase != null) {
        if (remaining.length > 1) {
          const meta = extractRunMeta(remaining);
          ungrouped.push({
            kind: 'run-group',
            runId: item.runId,
            items: remaining,
            ...meta,
            skill: meta.skill ?? (consumedDiscoverPhase === 'grill' ? 'grill-me' : 'write-prd'),
          });
        } else {
          ungrouped.push(...remaining);
        }
      } else {
        ungrouped.push(item);
      }
      continue;
    }

    ungrouped.push(item);
  }

  const phases: RenderItem[] = [];
  for (const grouped of phaseItems.values()) {
    for (const phase of ['grill', 'prd'] as const) {
      const phaseItemList = grouped[phase];
      if (phaseItemList.length === 0) continue;
      const times = extractPhaseTimes(phaseItemList);
      phases.push({
        kind: 'phase-group',
        phase,
        pipelineRunId: grouped.id,
        idKind: grouped.idKind,
        items: withDefaultDiscoverRunSkill(phaseItemList, phase).sort(compareRenderItems),
        status: resolveDiscoverPhaseStatus(phase, phaseItemList),
        ...times,
      });
    }
  }

  return [...ungrouped, ...phases].sort(compareRenderItems);
}

function withDefaultDiscoverRunSkill(items: RenderItem[], phase: 'grill' | 'prd'): RenderItem[] {
  const skill = phase === 'grill' ? 'grill-me' : 'write-prd';
  return items.map((item) => {
    if (item.kind === 'run-group' && item.skill == null) return { ...item, skill };
    return item;
  });
}

function isContractPhaseItem(item: RenderItem): boolean {
  if (item.kind === 'run-group') {
    return item.skill === 'spec-author' || item.skill === 'acceptance-contract';
  }
  if (item.kind !== 'event') return false;
  return item.event.kind === 'spec.completed' || item.event.kind === 'acceptance.contract-authored';
}

function contractPhaseId(item: RenderItem): string | null {
  if (!isContractPhaseItem(item)) return null;
  if (item.kind === 'run-group') return item.runId;
  if (item.kind === 'event') return item.event.runId ?? item.event.kind;
  return null;
}

function resolveContractPhaseStatus(
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  if (events.some((event) => event.kind === 'agent.run-failed')) return 'failed';
  if (events.some((event) => event.kind === 'spec.completed')) return 'completed';
  if (events.some((event) => event.kind === 'acceptance.contract-authored')) return 'completed';
  if (events.some((event) => event.kind === 'agent.run-completed')) return 'completed';
  return items.some(hasLiveRunGroup) ? 'live' : 'started';
}

export function groupByContractPhase(items: RenderItem[]): RenderItem[] {
  const phaseItems = new Map<string, RenderItem[]>();
  const ungrouped: RenderItem[] = [];

  for (const item of items) {
    const id = contractPhaseId(item);
    if (id == null) {
      ungrouped.push(item);
      continue;
    }
    const group = phaseItems.get(id) ?? [];
    group.push(item);
    phaseItems.set(id, group);
  }

  if (phaseItems.size === 0) return items;

  const phases: RenderItem[] = [];
  for (const [id, phaseItemList] of phaseItems) {
    const times = extractPhaseTimes(phaseItemList);
    phases.push({
      kind: 'phase-group',
      phase: 'contract',
      pipelineRunId: id,
      idKind: 'contract',
      items: phaseItemList.sort(compareRenderItems),
      status: resolveContractPhaseStatus(phaseItemList),
      ...times,
    });
  }

  return [...ungrouped, ...phases].sort(compareRenderItems);
}

export function groupByDevPhase(items: RenderItem[]): RenderItem[] {
  return groupByDevPhaseWithPipelineIndex(
    items,
    buildImplementationPipelineRunIndex(items.flatMap(eventFromRenderItem)),
  );
}

function groupByDevPhaseWithPipelineIndex(
  items: RenderItem[],
  implementationPipelineByRunId: ReadonlyMap<string, string>,
): RenderItem[] {
  const pipelines = new Set<string>();

  function collectPipelineIds(renderItems: RenderItem[]): void {
    for (const item of renderItems) {
      if (item.kind === 'event') {
        const pipelineRunId = implementationPipelineIdForEvent(
          item.event,
          implementationPipelineByRunId,
        );
        if (
          pipelineRunId != null &&
          (item.event.kind === 'spec.completed' || isDevPhaseEvent(item.event))
        ) {
          pipelines.add(pipelineRunId);
        }
      } else if (item.kind === 'run-group') {
        const pipelineRunId = implementationPipelineIdForDevRunGroup(
          item,
          implementationPipelineByRunId,
        );
        if (pipelineRunId != null) pipelines.add(pipelineRunId);
        collectPipelineIds(item.items);
      } else if (item.kind === 'phase-group' && item.phase === 'contract') {
        collectPipelineIds(item.items);
      }
    }
  }

  collectPipelineIds(items);

  if (pipelines.size === 0) return items;

  function resolvedPipelineId(item: RenderItem): string | null {
    if (item.kind === 'run-group') {
      const pipelineRunId = implementationPipelineIdForDevRunGroup(
        item,
        implementationPipelineByRunId,
      );
      return pipelineRunId != null && pipelines.has(pipelineRunId) ? pipelineRunId : null;
    }
    if (item.kind === 'event') {
      if (!isDevPhaseEvent(item.event)) return null;
      const pipelineRunId = implementationPipelineIdForEvent(
        item.event,
        implementationPipelineByRunId,
      );
      if (pipelineRunId != null && pipelines.has(pipelineRunId)) return pipelineRunId;
      return null;
    }
    return null;
  }

  const pipelineItems = new Map<string, RenderItem[]>();
  for (const pid of pipelines) pipelineItems.set(pid, []);

  const ungrouped: RenderItem[] = [];
  for (const item of items) {
    const pid = resolvedPipelineId(item);
    if (pid != null) {
      pipelineItems.get(pid)?.push(item);
    } else {
      ungrouped.push(item);
    }
  }

  const phaseGroups: RenderItem[] = [];
  for (const [pid, phaseItemList] of pipelineItems) {
    if (phaseItemList.length === 0) continue;
    const times = extractPhaseTimes(phaseItemList);
    phaseGroups.push({
      kind: 'phase-group',
      phase: 'dev',
      pipelineRunId: pid,
      idKind: 'pipeline',
      items: flattenLifecycleOnlyRunGroups(phaseItemList),
      status: resolveDevPhaseStatus(pid, phaseItemList),
      ...times,
    });
  }

  return [...ungrouped, ...phaseGroups].sort(compareRenderItems);
}

function flattenLifecycleOnlyRunGroups(items: RenderItem[]): RenderItem[] {
  return items.flatMap((item) => {
    if (item.kind === 'run-group' && isLifecycleOnlyRunGroup(item)) return item.items;
    return [item];
  });
}

function isLifecycleOnlyRunGroup(item: Extract<RenderItem, { kind: 'run-group' }>): boolean {
  if (item.personaId != null || item.modelId != null || item.runtime != null) return false;
  const events = eventFromRenderItem(item);
  return events.length > 0 && events.every((event) => !event.kind.startsWith('agent.'));
}

export const VISIBLE_INTERVENTION_EVENT_TYPES = new Set([
  'open',
  'propose',
  'proposalFailed',
  'decide',
  'markApplying',
  'recordApplicationResult',
  'verify',
  'resolve',
  'reopen',
  'abort',
  'supersede',
  'applyLeaseRecovered',
]);

const CLOSED_INTERVENTION_STATUSES = new Set(['RESOLVED', 'ABORTED', 'SUPERSEDED']);

function buildInterventionGroup(detail: InterventionTimelineDetail): RenderItem {
  const events = detail.events
    .filter((event) => VISIBLE_INTERVENTION_EVENT_TYPES.has(event.eventType))
    .sort((a, b) => {
      const timestampDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return timestampDelta === 0 ? a.id - b.id : timestampDelta;
    });
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  return {
    kind: 'intervention-group',
    intervention: detail.intervention,
    events,
    startedAt: firstEvent?.createdAt ?? detail.intervention.createdAt,
    lastEventAt: lastEvent?.createdAt ?? detail.intervention.updatedAt,
    endedAt:
      CLOSED_INTERVENTION_STATUSES.has(detail.intervention.status) &&
      detail.intervention.resolvedAt != null
        ? detail.intervention.resolvedAt
        : null,
  };
}

export function groupEvents(
  events: AgentEventDto[],
  interventionDetails: InterventionTimelineDetail[] = [],
): RenderItem[] {
  const normalizedEvents = events.flatMap((event) => {
    if (isGrillReplyManualAction(event)) return [];
    const normalized = normalizeAgentLogEvent(event);
    return normalized == null ? [] : [normalized];
  });
  const collapsed = collapseLogRuns(normalizedEvents);
  const grouped = groupByRunId(collapsed);
  const interventionGroups = interventionDetails.map(buildInterventionGroup);
  const withDiscoverPhases = groupByDiscoverPhase(
    [...grouped, ...interventionGroups].sort(compareRenderItems),
  );
  const withInvestigationPhases = groupByInvestigationPhase(
    [...withDiscoverPhases].sort(compareRenderItems),
  );
  const withReviewGroups = groupByReviewWorkflow(
    [...withInvestigationPhases].sort(compareRenderItems),
  );
  const withContractPhases = groupByContractPhase([...withReviewGroups].sort(compareRenderItems));
  return groupByDevPhase([...withContractPhases].sort(compareRenderItems));
}

export function groupTimelineEventsByCanonicalSection(
  events: AgentEventDto[],
  interventionDetails: InterventionTimelineDetail[] = [],
): RenderItem[] {
  const normalizedEvents = normalizeTimelineEvents(events);
  const runMetadata = buildTimelineRunMetadataIndex(normalizedEvents);
  const implementationPipelineByRunId = buildImplementationPipelineRunIndex(normalizedEvents);
  const reviewWorkflowByRunId = buildReviewWorkflowRunIndex(normalizedEvents);
  const discoverSessionByWorkflowOrRunId = buildDiscoverSessionRunIndex(normalizedEvents);
  const fixFeedbackAttemptByRunId = buildFixFeedbackAttemptRunIndex(normalizedEvents);
  const prdWorkflowByRevisionEventId = buildPrdRevisionWorkflowIndex(normalizedEvents);
  const segments = buildTimelineSegments(
    normalizedEvents,
    runMetadata,
    implementationPipelineByRunId,
    reviewWorkflowByRunId,
    discoverSessionByWorkflowOrRunId,
    fixFeedbackAttemptByRunId,
    prdWorkflowByRevisionEventId,
  );
  const standaloneItems: RenderItem[] = [
    ...normalizedEvents
      .filter((event) =>
        isStandaloneTimelineSection(resolveTimelineSection(event, { runMetadata })),
      )
      .map((event): RenderItem => ({ kind: 'event', event })),
    ...interventionDetails.map(buildInterventionGroup),
  ];

  const sectionItems = segments.flatMap((segment): RenderItem[] => {
    const rawItems = groupRawSectionEvents(segment.events);
    const groupedItems = groupItemsInsideTimelineSection(
      segment.section,
      rawItems,
      implementationPipelineByRunId,
      reviewWorkflowByRunId,
      discoverSessionByWorkflowOrRunId,
    );
    if (groupedItems.length === 0) return [];
    const times = extractTimelineSectionTimes(groupedItems);
    return [
      {
        kind: 'timeline-section',
        segmentId: segment.id,
        section: segment.section,
        items: sortTimelineChildrenForReading(groupedItems),
        ...times,
      },
    ];
  });

  return [...sectionItems, ...standaloneItems].sort(compareTopLevelTimelineItems);
}

type TimelineSegmentAccumulator = {
  id: string;
  section: TimelineSectionId;
  events: AgentEventDto[];
  startedMs: number;
  lastMs: number;
};

const IMPLICIT_SEGMENT_GAP_MS = 5 * 60 * 1000;

function buildTimelineSegments(
  events: AgentEventDto[],
  runMetadata: ReturnType<typeof buildTimelineRunMetadataIndex>,
  implementationPipelineByRunId: ReadonlyMap<string, string>,
  reviewWorkflowByRunId: ReadonlyMap<string, string>,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex,
  fixFeedbackAttemptByRunId: ReadonlyMap<string, string>,
  prdWorkflowByRevisionEventId: ReadonlyMap<number, string>,
): TimelineSegmentAccumulator[] {
  const segments = new Map<string, TimelineSegmentAccumulator>();
  const orderedEvents = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id,
  );
  const implicitSegmentBySection = new Map<TimelineSectionId, TimelineSegmentAccumulator>();
  let implicitSequence = 0;

  for (const event of orderedEvents) {
    const section = resolveTimelineSection(event, { runMetadata });
    if (isStandaloneTimelineSection(section)) continue;

    const eventMs = new Date(event.createdAt).getTime();
    const explicitKey = timelineSegmentExplicitKey(
      event,
      section,
      implementationPipelineByRunId,
      reviewWorkflowByRunId,
      discoverSessionByWorkflowOrRunId,
      fixFeedbackAttemptByRunId,
      prdWorkflowByRevisionEventId,
    );
    let segment: TimelineSegmentAccumulator | undefined;

    if (explicitKey != null) {
      const id = `${section}:${explicitKey}`;
      segment = segments.get(id);
      if (segment == null) {
        segment = { id, section, events: [], startedMs: eventMs, lastMs: eventMs };
        segments.set(id, segment);
      }
    } else {
      const previous = implicitSegmentBySection.get(section);
      const continuesPrevious =
        previous != null && eventMs - previous.lastMs <= IMPLICIT_SEGMENT_GAP_MS;
      if (continuesPrevious) {
        segment = previous;
      } else {
        const id = `${section}:implicit:${++implicitSequence}`;
        segment = { id, section, events: [], startedMs: eventMs, lastMs: eventMs };
        segments.set(id, segment);
        implicitSegmentBySection.set(section, segment);
      }
    }

    segment.events.push(event);
    segment.startedMs = Math.min(segment.startedMs, eventMs);
    segment.lastMs = Math.max(segment.lastMs, eventMs);
  }

  return [...segments.values()];
}

function isStandaloneTimelineSection(section: TimelineSectionId): boolean {
  return section === 'transitions';
}

function timelineSegmentExplicitKey(
  event: AgentEventDto,
  section: TimelineSectionId,
  implementationPipelineByRunId: ReadonlyMap<string, string>,
  reviewWorkflowByRunId: ReadonlyMap<string, string>,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex,
  fixFeedbackAttemptByRunId: ReadonlyMap<string, string>,
  prdWorkflowByRevisionEventId: ReadonlyMap<number, string>,
): string | null {
  const payload = event.payload as Record<string, unknown> | null;
  const stringPayload = (key: string): string | null => {
    const value = payload?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  const runId = event.runId ?? null;
  const pipelineRunId = stringPayload('pipelineRunId');
  const workflowRunId = stringPayload('workflowRunId');
  const discoverPhaseId = getDiscoverPhaseId(event, discoverSessionByWorkflowOrRunId);
  const discoverPhase = eventDiscoverPhase(event, discoverSessionByWorkflowOrRunId);

  switch (section) {
    case 'triage':
      return workflowRunId;
    case 'investigation':
      return (
        stringPayload('parentRunId') ??
        getInvestigationRunIdFromRunId(runId) ??
        stringPayload('investigationRunId') ??
        runId
      );
    case 'grill':
      return discoverPhase?.id ?? discoverPhaseId?.id ?? workflowRunId ?? runId;
    case 'prd':
      return prdWorkflowSegmentIdForEvent(event, prdWorkflowByRevisionEventId) ?? runId;
    case 'decompose':
      return workflowRunId ?? runId;
    case 'delivery-router':
      return pipelineRunId ?? workflowRunId ?? runId;
    case 'implementation':
      return (
        fixFeedbackSegmentIdForEvent(event, fixFeedbackAttemptByRunId) ??
        implementationPipelineIdForEvent(event, implementationPipelineByRunId) ??
        runId
      );
    case 'dev-review':
      return (
        implementationPipelineIdForEvent(event, implementationPipelineByRunId) ??
        stringPayload('devReviewRunId') ??
        runId
      );
    case 'qa':
      return qaSegmentIdForEvent(event, implementationPipelineByRunId);
    case 'review':
      return reviewWorkflowIdForEvent(event, reviewWorkflowByRunId) ?? runId;
    case 'conflict':
      return stringPayload('conflictRunId') ?? runId;
    case 'retro':
      return runId;
    case 'system':
      return null;
    case 'transitions':
      return null;
  }
}

function getInvestigationRunIdFromRunId(runId: string | null): string | null {
  if (runId == null) return null;
  const markerIndex = runId.indexOf(':scout:');
  return markerIndex > 0 ? runId.slice(0, markerIndex) : null;
}

function getPipelineRunIdFromRunId(runId: string | null): string | null {
  if (runId == null) return null;
  const markerIndex = runId.indexOf(':wp:');
  return markerIndex > 0 ? runId.slice(0, markerIndex) : null;
}

function eventPayloadString(event: AgentEventDto, key: string): string | null {
  const payload = event.payload as Record<string, unknown> | null;
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function buildDiscoverSessionRunIndex(events: AgentEventDto[]): Map<string, string> {
  const sessionByWorkflowOrRunId = new Map<string, string>();
  const discoverSessionIds = new Set<string>();

  for (const event of events) {
    const discoverSessionId = eventPayloadString(event, 'discoverSessionId');
    if (discoverSessionId == null) continue;
    discoverSessionIds.add(discoverSessionId);

    const workflowRunId = eventPayloadString(event, 'workflowRunId');
    if (workflowRunId != null) {
      sessionByWorkflowOrRunId.set(discoverIndexKey('workflow', workflowRunId), discoverSessionId);
    }
    if (event.runId != null && event.runId.trim() !== '') {
      sessionByWorkflowOrRunId.set(discoverIndexKey('run', event.runId), discoverSessionId);
    }
  }

  if (discoverSessionIds.size === 1) {
    const [discoverSessionId] = discoverSessionIds;
    for (const event of events) {
      const skill = eventSkill(event);
      if (skill !== 'grill-me' && skill !== 'write-prd' && skill !== 'advise-on-prd') continue;
      const workflowRunId = eventPayloadString(event, 'workflowRunId');
      if (workflowRunId != null) {
        sessionByWorkflowOrRunId.set(
          discoverIndexKey('workflow', workflowRunId),
          discoverSessionId,
        );
      }
      if (event.runId != null && event.runId.trim() !== '') {
        sessionByWorkflowOrRunId.set(discoverIndexKey('run', event.runId), discoverSessionId);
      }
    }
  }

  return sessionByWorkflowOrRunId;
}

function prdWorkflowIdForEvent(event: AgentEventDto): string | null {
  const workflowRunId = eventPayloadString(event, 'workflowRunId');
  if (workflowRunId != null) return workflowRunId;
  if (event.runId?.endsWith(':write-prd')) return event.runId.slice(0, -':write-prd'.length);
  if (event.runId?.endsWith(':advise-on-prd')) {
    return event.runId.slice(0, -':advise-on-prd'.length);
  }
  if (event.kind.startsWith('prd.') && event.runId != null && event.runId.trim() !== '') {
    return event.runId;
  }
  return null;
}

function buildPrdRevisionWorkflowIndex(events: AgentEventDto[]): Map<number, string> {
  const workflowByRevisionEventId = new Map<number, string>();
  const pendingRevisionsBySession = new Map<string, AgentEventDto[]>();
  const orderedEvents = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id,
  );

  for (const event of orderedEvents) {
    if (event.kind === 'prd.revised' && prdWorkflowIdForEvent(event) == null) {
      const discoverSessionId = getDiscoverSessionId(event);
      if (discoverSessionId == null) continue;
      const revisions = pendingRevisionsBySession.get(discoverSessionId) ?? [];
      revisions.push(event);
      pendingRevisionsBySession.set(discoverSessionId, revisions);
      continue;
    }

    if (event.kind !== 'agent.run-started') continue;
    const skill = eventSkill(event);
    if (skill !== 'write-prd' && skill !== 'advise-on-prd') continue;
    const discoverSessionId = getDiscoverSessionId(event);
    if (discoverSessionId == null) continue;
    const workflowRunId = prdWorkflowIdForEvent(event);
    if (workflowRunId == null) continue;
    const pendingRevisions = pendingRevisionsBySession.get(discoverSessionId);
    if (pendingRevisions == null) continue;
    for (const revision of pendingRevisions)
      workflowByRevisionEventId.set(revision.id, workflowRunId);
    pendingRevisionsBySession.delete(discoverSessionId);
  }

  return workflowByRevisionEventId;
}

function prdWorkflowSegmentIdForEvent(
  event: AgentEventDto,
  prdWorkflowByRevisionEventId: ReadonlyMap<number, string>,
): string | null {
  return prdWorkflowIdForEvent(event) ?? prdWorkflowByRevisionEventId.get(event.id) ?? null;
}

function buildImplementationPipelineRunIndex(events: AgentEventDto[]): Map<string, string> {
  const pipelineByRunId = new Map<string, string>();
  const pipelineRunIds = new Set<string>();

  for (const event of events) {
    const pipelineRunId = eventPayloadString(event, 'pipelineRunId');
    if (pipelineRunId == null) continue;
    pipelineRunIds.add(pipelineRunId);

    const runIds = new Set<string>();
    if (event.runId != null && event.runId.trim() !== '') runIds.add(event.runId);
    const wpRunId = eventPayloadString(event, 'wpRunId');
    if (wpRunId != null) runIds.add(wpRunId);

    for (const runId of [...runIds]) {
      const parentRunId = getPipelineRunIdFromRunId(runId);
      if (parentRunId != null) runIds.add(parentRunId);
    }

    for (const runId of runIds) pipelineByRunId.set(runId, pipelineRunId);
  }

  if (pipelineRunIds.size === 1) {
    const [pipelineRunId] = pipelineRunIds;
    for (const event of events) {
      if (!isPipelineRelatedRuntimeEvent(event)) continue;
      const runId = event.runId;
      if (runId == null || runId.trim() === '') continue;
      pipelineByRunId.set(runId, pipelineRunId);
      const parentRunId = getPipelineRunIdFromRunId(runId);
      if (parentRunId != null) pipelineByRunId.set(parentRunId, pipelineRunId);
    }
  }

  return pipelineByRunId;
}

function eventSkill(event: AgentEventDto): string | null {
  return eventPayloadString(event, 'skill') ?? eventPayloadString(event, 'workflowSkill');
}

function eventHasWorkflowIdentity(event: AgentEventDto, skill: string): boolean {
  return (
    eventPayloadString(event, 'displaySkill') === skill ||
    eventPayloadString(event, 'workflowSkill') === skill ||
    eventPayloadString(event, 'skill') === skill
  );
}

function isFixFeedbackRelatedEvent(event: AgentEventDto): boolean {
  return (
    event.kind === 'agent.fix-feedback-complete' ||
    eventHasWorkflowIdentity(event, 'fix-feedback') ||
    eventPayloadString(event, 'by') === 'fix-feedback'
  );
}

function buildFixFeedbackAttemptRunIndex(events: AgentEventDto[]): Map<string, string> {
  const attemptByRunId = new Map<string, string>();
  const attemptIds = new Set<string>();

  for (const event of events) {
    if (!isFixFeedbackRelatedEvent(event)) continue;
    const attemptId = eventPayloadString(event, 'attemptId');
    if (attemptId == null) continue;
    attemptIds.add(attemptId);
    if (event.runId != null && event.runId.trim() !== '') {
      attemptByRunId.set(event.runId, attemptId);
    }
  }

  if (attemptIds.size === 1) {
    const [attemptId] = attemptIds;
    for (const event of events) {
      if (!isFixFeedbackRelatedEvent(event)) continue;
      if (event.runId != null && event.runId.trim() !== '') {
        attemptByRunId.set(event.runId, attemptId);
      }
    }
  }

  return attemptByRunId;
}

function fixFeedbackSegmentIdForEvent(
  event: AgentEventDto,
  fixFeedbackAttemptByRunId: ReadonlyMap<string, string>,
): string | null {
  if (!isFixFeedbackRelatedEvent(event)) return null;
  const attemptId =
    eventPayloadString(event, 'attemptId') ??
    (event.runId == null ? null : (fixFeedbackAttemptByRunId.get(event.runId) ?? null));
  if (attemptId != null) return `fix-feedback:${attemptId}`;
  return event.runId == null ? null : `fix-feedback:${event.runId}`;
}

function isPipelineRelatedRuntimeEvent(event: AgentEventDto): boolean {
  if (event.kind.startsWith('parallel-implement.')) return true;
  if (event.kind.startsWith('qa.')) return true;
  if (event.kind.startsWith('dev-review.')) return true;
  const skill = eventSkill(event);
  return (
    skill === 'parallel-implement' ||
    skill === 'implement-wp' ||
    skill === 'qa' ||
    skill === 'dev-review'
  );
}

function buildReviewWorkflowRunIndex(events: AgentEventDto[]): Map<string, string> {
  const reviewWorkflowByRunId = new Map<string, string>();
  const reviewWorkflowRunIds = new Set<string>();

  for (const event of events) {
    const reviewWorkflowRunId = eventPayloadString(event, 'reviewWorkflowRunId');
    if (reviewWorkflowRunId == null) continue;
    reviewWorkflowRunIds.add(reviewWorkflowRunId);

    if (event.runId != null && event.runId.trim() !== '') {
      reviewWorkflowByRunId.set(event.runId, reviewWorkflowRunId);
    }
  }

  if (reviewWorkflowRunIds.size === 1) {
    const [reviewWorkflowRunId] = reviewWorkflowRunIds;
    for (const event of events) {
      if (eventSkill(event) !== 'review') continue;
      const runId = event.runId;
      if (runId == null || runId.trim() === '') continue;
      reviewWorkflowByRunId.set(runId, reviewWorkflowRunId);
    }
  }

  return reviewWorkflowByRunId;
}

function reviewWorkflowIdForEvent(
  event: AgentEventDto,
  reviewWorkflowByRunId: ReadonlyMap<string, string>,
): string | null {
  return (
    eventPayloadString(event, 'reviewWorkflowRunId') ??
    (event.runId == null ? null : (reviewWorkflowByRunId.get(event.runId) ?? null))
  );
}

function implementationPipelineIdForRunId(
  runId: string | null,
  implementationPipelineByRunId: ReadonlyMap<string, string>,
): string | null {
  if (runId == null) return null;
  const mapped = implementationPipelineByRunId.get(runId);
  if (mapped != null) return mapped;

  const parentRunId = getPipelineRunIdFromRunId(runId);
  if (parentRunId == null) return null;
  return implementationPipelineByRunId.get(parentRunId) ?? parentRunId;
}

function implementationPipelineIdForEvent(
  event: AgentEventDto,
  implementationPipelineByRunId: ReadonlyMap<string, string>,
): string | null {
  return (
    eventPayloadString(event, 'pipelineRunId') ??
    implementationPipelineIdForRunId(event.runId ?? null, implementationPipelineByRunId)
  );
}

function qaSegmentIdForEvent(
  event: AgentEventDto,
  implementationPipelineByRunId: ReadonlyMap<string, string>,
): string | null {
  if (event.runId != null && event.runId.trim() !== '') return event.runId;
  return implementationPipelineIdForEvent(event, implementationPipelineByRunId);
}

function isDevPhaseEvent(event: AgentEventDto): boolean {
  if (event.kind.startsWith('parallel-implement.')) return true;
  if (event.kind.startsWith('dev-review.')) return true;
  return (
    event.kind === 'agent.implement-complete' ||
    event.kind === 'agent.fix-feedback-complete' ||
    event.kind === 'pr.opened' ||
    event.kind === 'state.transitioned'
  );
}

function isImplementationRunGroup(item: Extract<RenderItem, { kind: 'run-group' }>): boolean {
  if (item.skill === 'spec-author' || item.skill === 'acceptance-contract') return false;
  if (item.skill === 'implement-wp' || item.skill === 'implement' || item.skill === 'developer') {
    return true;
  }
  if (item.runId.includes(':wp:')) return true;
  return eventFromRenderItem(item).some(isDevPhaseEvent);
}

function implementationPipelineIdForDevRunGroup(
  item: Extract<RenderItem, { kind: 'run-group' }>,
  implementationPipelineByRunId: ReadonlyMap<string, string>,
): string | null {
  if (!isImplementationRunGroup(item)) return null;
  for (const event of eventFromRenderItem(item)) {
    if (!isDevPhaseEvent(event)) continue;
    const pipelineRunId = implementationPipelineIdForEvent(event, implementationPipelineByRunId);
    if (pipelineRunId != null) return pipelineRunId;
  }
  return implementationPipelineIdForRunId(item.runId, implementationPipelineByRunId);
}

function compareTopLevelTimelineItems(a: RenderItem, b: RenderItem): number {
  const startDelta = optionalTimestamp(itemStartedAt(b)) - optionalTimestamp(itemStartedAt(a));
  if (startDelta !== 0) return startDelta;
  return compareRenderItems(a, b);
}

function compareTimelineChildrenForReading(a: RenderItem, b: RenderItem): number {
  const startDelta = optionalTimestamp(itemStartedAt(b)) - optionalTimestamp(itemStartedAt(a));
  if (startDelta !== 0) return startDelta;

  const activityDelta = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (activityDelta !== 0) return activityDelta;

  if (a.kind === 'run-group' && b.kind === 'run-group') return a.runId.localeCompare(b.runId);
  if (a.kind === 'event' && b.kind === 'event') return a.event.id - b.event.id;
  return 0;
}

function sortTimelineChildrenForReading(items: RenderItem[]): RenderItem[] {
  return items.map(sortTimelineItemChildrenForReading).sort(compareTimelineChildrenForReading);
}

function sortTimelineItemChildrenForReading(item: RenderItem): RenderItem {
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group'
  ) {
    return { ...item, items: sortTimelineChildrenForReading(item.items) };
  }
  return item;
}

function normalizeTimelineEvents(events: AgentEventDto[]): AgentEventDto[] {
  return events.flatMap((event) => {
    if (isGrillReplyManualAction(event)) return [];
    const normalized = normalizeAgentLogEvent(event);
    return normalized == null ? [] : [normalized];
  });
}

function groupRawSectionEvents(events: AgentEventDto[]): RenderItem[] {
  return groupByRunId(collapseLogRuns(events));
}

function groupItemsInsideTimelineSection(
  section: TimelineSectionId,
  items: RenderItem[],
  implementationPipelineByRunId: ReadonlyMap<string, string>,
  reviewWorkflowByRunId: ReadonlyMap<string, string>,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex,
): RenderItem[] {
  switch (section) {
    case 'investigation':
      return flattenRedundantSectionPhase(section, groupByInvestigationPhase(items));
    case 'grill':
    case 'prd':
      return flattenRedundantSectionPhase(
        section,
        groupByDiscoverPhaseWithSessionIndex(items, discoverSessionByWorkflowOrRunId),
      );
    case 'delivery-router':
      return flattenRedundantSectionPhase(section, groupByContractPhase(items));
    case 'implementation':
      return flattenRedundantSectionPhase(
        section,
        groupByDevPhaseWithPipelineIndex(items, implementationPipelineByRunId),
      );
    case 'review':
      return flattenRedundantSectionPhase(
        section,
        groupByReviewWorkflowWithIndex(items, reviewWorkflowByRunId),
      );
    default:
      return items;
  }
}

function flattenRedundantSectionPhase(
  section: TimelineSectionId,
  items: RenderItem[],
): RenderItem[] {
  if (section === 'grill' || section === 'prd') {
    const phase = section === 'grill' ? 'grill' : 'prd';
    const matchingPhases = items.filter(
      (item): item is Extract<RenderItem, { kind: 'phase-group' }> =>
        item.kind === 'phase-group' && item.phase === phase,
    );
    if (matchingPhases.length === 1) {
      return [
        ...items.filter((item) => !(item.kind === 'phase-group' && item.phase === phase)),
        ...matchingPhases[0].items,
      ].sort(compareRenderItems);
    }
  }

  if (items.length !== 1) return items;
  const [item] = items;
  if (section === 'investigation' && item.kind === 'investigation-phase') return item.items;
  if (section === 'delivery-router' && item.kind === 'phase-group' && item.phase === 'contract') {
    return item.items;
  }
  if (section === 'implementation' && item.kind === 'phase-group' && item.phase === 'dev') {
    return item.items;
  }
  if (section === 'review' && item.kind === 'review-group') return item.items;
  return items;
}

export function collectRunIdsForTimelineSection(items: RenderItem[]): Set<string> {
  const runIds = new Set<string>();
  for (const item of items) {
    if (item.kind === 'run-group') runIds.add(item.runId);
    if (item.kind === 'event' && item.event.runId != null) runIds.add(item.event.runId);
    if (item.kind === 'log-group') {
      for (const event of item.events) {
        if (event.runId != null) runIds.add(event.runId);
      }
    }
    if (
      item.kind === 'timeline-section' ||
      item.kind === 'run-group' ||
      item.kind === 'investigation-phase' ||
      item.kind === 'phase-group' ||
      item.kind === 'review-group'
    ) {
      for (const runId of collectRunIdsForTimelineSection(item.items)) runIds.add(runId);
    }
  }
  return runIds;
}

function collapseLogRuns(events: AgentEventDto[]): RenderItem[] {
  const items: RenderItem[] = [];
  const flushLogGroup = (group: AgentEventDto[]) => {
    if (group.length >= 4) {
      items.push({ kind: 'log-group', events: group });
    } else {
      for (const ev of group) {
        items.push({ kind: 'event', event: ev });
      }
    }
  };
  let i = 0;
  while (i < events.length) {
    if (events[i].kind === 'agent.log') {
      const group: AgentEventDto[] = [];
      while (i < events.length && events[i].kind === 'agent.log') {
        if (isCodexTransportWarningLog(events[i])) {
          flushLogGroup(group);
          group.length = 0;
          items.push({ kind: 'event', event: events[i] });
          i++;
          continue;
        }
        group.push(events[i]);
        i++;
      }
      flushLogGroup(group);
    } else {
      items.push({ kind: 'event', event: events[i] });
      i++;
    }
  }
  return items;
}

function getRunId(item: RenderItem): string | null {
  if (item.kind === 'event') {
    return (item.event as AgentEventDto & { runId?: string | null }).runId ?? null;
  }
  return null;
}

function extractRunMeta(items: RenderItem[]): {
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  personaId: string | null;
  modelId: string | null;
  runtime: string | null;
} {
  let skill: string | null = null;
  let displaySkill: string | null = null;
  let lifecycleSkill: string | null = null;
  let fallbackSkill: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let personaId: string | null = null;
  let modelId: string | null = null;
  let runtime: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestIso: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;

  for (const item of items) {
    if (item.kind !== 'event') continue;
    const ev = item.event;
    const p = ev.payload as {
      displaySkill?: string;
      modelId?: string;
      runtime?: string;
      skill?: string;
      workflowSkill?: string;
    } | null;

    const ms = new Date(ev.createdAt).getTime();
    if (ms < earliestMs) {
      earliestMs = ms;
      earliestIso = ev.createdAt;
    }
    if (ms > latestMs) {
      latestMs = ms;
      latestIso = ev.createdAt;
    }

    if (personaId == null && ev.personaId != null) personaId = ev.personaId;

    if (displaySkill == null && p?.displaySkill != null) displaySkill = p.displaySkill;
    if (displaySkill == null && p?.workflowSkill != null) displaySkill = p.workflowSkill;
    if (displaySkill == null && ev.kind === 'agent.fix-feedback-complete') {
      displaySkill = 'fix-feedback';
    }
    if (fallbackSkill == null && p?.skill != null) fallbackSkill = p.skill;
    if (modelId == null && p?.modelId != null) modelId = p.modelId;
    if (runtime == null && p?.runtime != null) runtime = p.runtime;

    if (ev.kind === 'agent.run-started') {
      if (startedAt == null) startedAt = ev.createdAt;
      if (lifecycleSkill == null && p?.skill != null) lifecycleSkill = p.skill;
    } else if (ev.kind === 'agent.run-completed') {
      if (endedAt == null) endedAt = ev.createdAt;
      if (lifecycleSkill == null && p?.skill != null) lifecycleSkill = p.skill;
    } else if (ev.kind === 'agent.run-failed') {
      if (endedAt == null) endedAt = ev.createdAt;
      if (lifecycleSkill == null && p?.skill != null) lifecycleSkill = p.skill;
    } else if (ev.kind === 'agent.investigation-complete') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'retrospective.completed') {
      // retrospective runs don't always emit agent.run-completed; treat this as terminal
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'prd.approved' || ev.kind === 'prd.rejected') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'grill.question-posted' || ev.kind === 'grill.completed') {
      // grill-me runs don't emit agent.run-completed — these are the terminal events
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'decompose.completed') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'parallel-implement.iteration-started') {
      if (startedAt == null) startedAt = ev.createdAt;
      if (displaySkill == null) displaySkill = 'parallel-implement';
    } else if (
      ev.kind.startsWith('parallel-implement.') ||
      ev.kind === 'pr.opened' ||
      (ev.kind === 'state.transitioned' &&
        ((ev.payload as { to?: string; toState?: string } | null)?.to === 'factory:needs-qa' ||
          (ev.payload as { to?: string; toState?: string } | null)?.toState === 'factory:needs-qa'))
    ) {
      if (displaySkill == null) displaySkill = 'parallel-implement';
      if (
        ev.kind === 'pr.opened' ||
        ev.kind === 'parallel-implement.exhausted' ||
        (ev.kind === 'state.transitioned' &&
          ((ev.payload as { to?: string; toState?: string } | null)?.to === 'factory:needs-qa' ||
            (ev.payload as { to?: string; toState?: string } | null)?.toState ===
              'factory:needs-qa'))
      ) {
        if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
      }
    } else if (ev.kind.startsWith('qa.')) {
      if (displaySkill == null) displaySkill = 'qa';
      if (ev.kind === 'qa.completed' || ev.kind === 'qa.verification-blocked') {
        if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
      }
    } else if (ev.kind.startsWith('dev-review.')) {
      if (displaySkill == null) displaySkill = 'dev-review';
      if (
        ev.kind === 'dev-review.completed' ||
        ev.kind === 'dev-review.failed' ||
        ev.kind === 'dev-review.error'
      ) {
        if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
      }
    }
  }

  skill = displaySkill ?? lifecycleSkill ?? fallbackSkill;

  return {
    skill,
    startedAt: startedAt ?? earliestIso,
    endedAt,
    lastEventAt: latestIso,
    personaId,
    modelId,
    runtime,
  };
}

function groupByRunId(items: RenderItem[]): RenderItem[] {
  // Pass 1: collect all items per runId (order preserved).
  const byRunId = new Map<string, RenderItem[]>();
  for (const item of items) {
    const runId = getRunId(item);
    if (runId != null) {
      const group = byRunId.get(runId) ?? [];
      group.push(item);
      byRunId.set(runId, group);
    }
  }

  // Pass 2: walk original list; emit full group on first occurrence, skip rest.
  const seen = new Set<string>();
  const result: RenderItem[] = [];
  for (const item of items) {
    const runId = getRunId(item);
    if (runId != null) {
      if (seen.has(runId)) continue;
      seen.add(runId);
      const group = byRunId.get(runId) ?? [];
      if (group.length > 1) {
        const meta = extractRunMeta(group);
        result.push({ kind: 'run-group', runId, items: group, ...meta });
      } else {
        result.push(...group);
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

function getRenderItemRunId(item: RenderItem): string | null {
  if (item.kind === 'run-group') return item.runId;
  if (item.kind === 'event') return item.event.runId ?? null;
  return null;
}

function getInvestigationChildParentRunId(item: RenderItem): string | null {
  const runId = getRenderItemRunId(item);
  if (runId == null) return null;
  const marker = ':scout:';
  const markerIndex = runId.indexOf(marker);
  if (markerIndex <= 0) return null;
  return runId.slice(0, markerIndex);
}

function getInvestigationPayloadParentRunIds(item: RenderItem): string[] {
  const parentRunIds = new Set<string>();
  for (const event of eventFromRenderItem(item)) {
    if (!event.kind.startsWith('swarm.')) continue;
    const payload = event.payload as { parentRunId?: unknown } | null;
    if (typeof payload?.parentRunId === 'string' && payload.parentRunId.trim() !== '') {
      parentRunIds.add(payload.parentRunId);
    }
  }
  return [...parentRunIds];
}

function isInvestigationParentItem(item: RenderItem): boolean {
  if (item.kind === 'run-group') return item.skill === 'investigate';
  if (item.kind !== 'event') return false;
  const payload = item.event.payload as { skill?: string } | null;
  return (
    (item.event.kind === 'agent.run-started' && payload?.skill === 'investigate') ||
    item.event.kind === 'agent.investigation-complete'
  );
}

function withInvestigationParentSkill(item: RenderItem, investigationRunId: string): RenderItem {
  if (item.kind === 'run-group' && item.runId === investigationRunId && item.skill == null) {
    return { ...item, skill: 'investigate' };
  }
  return item;
}

function eventFromRenderItem(item: RenderItem): AgentEventDto[] {
  if (item.kind === 'event') return [item.event];
  if (item.kind === 'timeline-section') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'run-group') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'investigation-phase') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'phase-group') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'review-group') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'intervention-group') return [];
  return item.events;
}

function itemStartedAt(item: RenderItem): string | null {
  if (item.kind === 'event') return item.event.createdAt;
  if (item.kind === 'log-group') return item.events.at(-1)?.createdAt ?? null;
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group' ||
    item.kind === 'intervention-group'
  ) {
    return item.startedAt;
  }
  return null;
}

function itemEndedAt(item: RenderItem): string | null {
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group' ||
    item.kind === 'intervention-group'
  ) {
    return item.endedAt;
  }
  return null;
}

function itemLastEventAt(item: RenderItem): string | null {
  if (item.kind === 'event') return item.event.createdAt;
  if (item.kind === 'log-group') return item.events[0]?.createdAt ?? null;
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group' ||
    item.kind === 'intervention-group'
  ) {
    return item.lastEventAt;
  }
  return null;
}

function extractTimelineSectionTimes(items: RenderItem[]): {
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
} {
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let endedMs = Number.NEGATIVE_INFINITY;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let lastEventAt: string | null = null;

  for (const item of items) {
    const start = itemStartedAt(item);
    if (start != null) {
      const ms = new Date(start).getTime();
      if (ms < earliestMs) {
        earliestMs = ms;
        startedAt = start;
      }
    }

    const last = itemLastEventAt(item);
    if (last != null) {
      const ms = new Date(last).getTime();
      if (ms > latestMs) {
        latestMs = ms;
        lastEventAt = last;
      }
    }

    const end = itemEndedAt(item);
    if (end != null) {
      const ms = new Date(end).getTime();
      if (ms > endedMs) {
        endedMs = ms;
        endedAt = end;
      }
    }
  }

  return { startedAt, endedAt, lastEventAt };
}

function extractPhaseTimes(items: RenderItem[]): {
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
} {
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let lastEventAt: string | null = null;

  for (const event of items.flatMap(eventFromRenderItem)) {
    const ms = new Date(event.createdAt).getTime();
    if (ms < earliestMs) {
      earliestMs = ms;
      startedAt = event.createdAt;
    }
    if (ms > latestMs) {
      latestMs = ms;
      lastEventAt = event.createdAt;
    }
    if (
      event.kind === 'agent.investigation-complete' ||
      event.kind === 'agent.run-completed' ||
      event.kind === 'agent.run-failed' ||
      event.kind === 'swarm.wave-halted'
    ) {
      if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = event.createdAt;
    }
  }

  return { startedAt, endedAt, lastEventAt };
}

function hasLiveRunGroup(item: RenderItem): boolean {
  if (item.kind !== 'run-group') return false;
  return item.endedAt == null;
}

function resolveDevPhaseStatus(
  pipelineRunId: string,
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  const hasFailure = events.some((event) => {
    const payload = event.payload as {
      pipelineRunId?: string;
      to?: string;
      toState?: string;
    } | null;
    return (
      event.kind === 'parallel-implement.exhausted' ||
      event.kind === 'parallel-implement.wp-failed' ||
      event.kind === 'parallel-implement.wp-timeout' ||
      event.kind === 'parallel-implement.wp-commit-failed' ||
      event.kind === 'dev-review.failed' ||
      event.kind === 'dev-review.error' ||
      (event.kind === 'agent.run-failed' &&
        (event.runId === pipelineRunId || payload?.pipelineRunId === pipelineRunId)) ||
      (event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-human' || payload?.toState === 'factory:needs-human'))
    );
  });
  if (hasFailure) return 'failed';

  const hasCompletion = events.some((event) => {
    const payload = event.payload as {
      pipelineRunId?: string;
      to?: string;
      toState?: string;
    } | null;
    return (
      event.kind === 'pr.opened' ||
      (event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-qa' || payload?.toState === 'factory:needs-qa')) ||
      event.kind === 'dev-review.completed'
    );
  });
  if (hasCompletion) return 'completed';

  if (items.some(hasLiveRunGroup)) return 'live';

  const hasParallelActivity = events.some(
    (event) => event.kind.startsWith('parallel-implement.') || event.kind.startsWith('dev-review.'),
  );
  return hasParallelActivity ? 'live' : 'started';
}

function resolveInvestigationStatus(
  investigationRunId: string,
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  const hasFailure = events.some((event) => {
    const payload = event.payload as { to?: string; toState?: string } | null;
    return (
      (event.kind === 'agent.run-failed' && event.runId === investigationRunId) ||
      event.kind === 'swarm.wave-halted' ||
      (event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-human' || payload?.toState === 'factory:needs-human'))
    );
  });
  if (hasFailure) return 'failed';

  const hasCompletion = events.some(
    (event) =>
      event.kind === 'agent.investigation-complete' ||
      (event.kind === 'agent.run-completed' && event.runId === investigationRunId),
  );
  if (hasCompletion) return 'completed';

  const childCount = items.filter(
    (item) =>
      item.kind === 'run-group' && getInvestigationChildParentRunId(item) === investigationRunId,
  ).length;
  const eventCount = events.length;
  return childCount === 0 && eventCount <= 1 ? 'started' : 'live';
}

export function groupByInvestigationPhase(items: RenderItem[]): RenderItem[] {
  const parentRunIds = new Set<string>();
  for (const item of items) {
    const runId = getRenderItemRunId(item);
    if (runId != null && isInvestigationParentItem(item)) {
      parentRunIds.add(runId);
    }
    const childParentRunId = getInvestigationChildParentRunId(item);
    if (childParentRunId != null) {
      parentRunIds.add(childParentRunId);
    }
    for (const payloadParentRunId of getInvestigationPayloadParentRunIds(item)) {
      parentRunIds.add(payloadParentRunId);
    }
  }
  if (parentRunIds.size === 0) return items;

  const phaseItems = new Map<string, RenderItem[]>();
  for (const runId of parentRunIds) phaseItems.set(runId, []);

  const ungrouped: RenderItem[] = [];
  for (const item of items) {
    let phaseRunId: string | null = null;
    const runId = getRenderItemRunId(item);
    if (runId != null && parentRunIds.has(runId)) {
      phaseRunId = runId;
    } else {
      const parentRunId = getInvestigationChildParentRunId(item);
      if (parentRunId != null && parentRunIds.has(parentRunId)) {
        phaseRunId = parentRunId;
      }
      for (const payloadParentRunId of getInvestigationPayloadParentRunIds(item)) {
        if (parentRunIds.has(payloadParentRunId)) {
          phaseRunId = payloadParentRunId;
          break;
        }
      }
    }

    if (phaseRunId != null) {
      phaseItems.get(phaseRunId)?.push(withInvestigationParentSkill(item, phaseRunId));
    } else {
      ungrouped.push(item);
    }
  }

  const phases: RenderItem[] = [];
  for (const [investigationRunId, phaseItemList] of phaseItems) {
    if (phaseItemList.length === 0) continue;
    const times = extractPhaseTimes(phaseItemList);
    phases.push({
      kind: 'investigation-phase',
      investigationRunId,
      items: phaseItemList.sort(compareRenderItems),
      status: resolveInvestigationStatus(investigationRunId, phaseItemList),
      ...times,
    });
  }

  return [...ungrouped, ...phases].sort(compareRenderItems);
}

function reviewWorkflowRunIdsForItem(
  item: RenderItem,
  reviewWorkflowByRunId: ReadonlyMap<string, string> = new Map(),
): string[] {
  const ids = new Set<string>();
  for (const event of eventFromRenderItem(item)) {
    const reviewWorkflowRunId = reviewWorkflowIdForEvent(event, reviewWorkflowByRunId);
    if (reviewWorkflowRunId != null) ids.add(reviewWorkflowRunId);
  }
  return [...ids];
}

function resolveReviewStatus(items: RenderItem[]): 'live' | 'completed' | 'needs-human' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  if (events.some((event) => event.kind === 'review.wave-failed')) return 'failed';
  if (events.some((event) => event.kind === 'agent.run-failed')) return 'failed';
  if (events.some((event) => event.kind === 'review.escalated')) return 'needs-human';
  if (
    events.some((event) => {
      const payload = event.payload as { to?: string; toState?: string } | null;
      return (
        event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-human' || payload?.toState === 'factory:needs-human')
      );
    })
  ) {
    return 'needs-human';
  }

  const completed = events
    .filter((event) => event.kind === 'review.completed')
    .sort((a, b) => a.id - b.id)
    .at(-1);
  const verdict = (completed?.payload as { verdict?: string } | null)?.verdict;
  if (verdict === 'needs-human') return 'needs-human';
  if (verdict === 'approved' || verdict === 'needs-fix') return 'completed';
  return 'live';
}

export function groupByReviewWorkflow(items: RenderItem[]): RenderItem[] {
  return groupByReviewWorkflowWithIndex(
    items,
    buildReviewWorkflowRunIndex(items.flatMap(eventFromRenderItem)),
  );
}

function groupByReviewWorkflowWithIndex(
  items: RenderItem[],
  reviewWorkflowByRunId: ReadonlyMap<string, string>,
): RenderItem[] {
  const reviewWorkflowRunIds = new Set<string>();
  for (const item of items) {
    for (const id of reviewWorkflowRunIdsForItem(item, reviewWorkflowByRunId)) {
      reviewWorkflowRunIds.add(id);
    }
  }
  if (reviewWorkflowRunIds.size === 0) return items;

  const reviewItems = new Map<string, RenderItem[]>();
  for (const id of reviewWorkflowRunIds) reviewItems.set(id, []);

  const ungrouped: RenderItem[] = [];
  for (const item of items) {
    const ids = reviewWorkflowRunIdsForItem(item, reviewWorkflowByRunId).filter((id) =>
      reviewWorkflowRunIds.has(id),
    );
    if (ids.length === 0) {
      ungrouped.push(item);
      continue;
    }
    reviewItems.get(ids[0])?.push(item);
  }

  const groups: RenderItem[] = [];
  for (const [reviewWorkflowRunId, groupedItems] of reviewItems) {
    if (groupedItems.length === 0) continue;
    const times = extractPhaseTimes(groupedItems);
    const status = resolveReviewStatus(groupedItems);
    groups.push({
      kind: 'review-group',
      reviewWorkflowRunId,
      items: flattenLifecycleOnlyRunGroups(groupedItems).sort(compareRenderItems),
      status,
      ...times,
      endedAt: status === 'live' ? null : (times.endedAt ?? times.lastEventAt),
    });
  }

  return [...ungrouped, ...groups].sort(compareRenderItems);
}

// ─── run-state detection ─────────────────────────────────────────────────────

const TERMINAL_EVENTS = new Set([
  'agent.run-completed',
  'agent.run-failed',
  'grill.question-posted',
  'grill.completed',
  'decompose.completed',
  'retrospective.completed',
  'prd.drafted',
  'pr.opened',
  'parallel-implement.exhausted',
  'qa.completed',
  'qa.verification-blocked',
]);

export function computeIsLive(events: AgentEventDto[]): boolean {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let lastStartedIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].kind === 'agent.run-started') lastStartedIdx = i;
  }
  if (lastStartedIdx === -1) return false;
  for (let i = lastStartedIdx + 1; i < sorted.length; i++) {
    if (TERMINAL_EVENTS.has(sorted[i].kind)) return false;
  }
  return true;
}

export function computeIsWritePrdStuck(events: AgentEventDto[]): boolean {
  const hasWritePrdCompleted = events.some(
    (e) =>
      e.kind === 'agent.run-completed' &&
      (e.payload as { skill?: string } | null)?.skill === 'write-prd',
  );
  if (!hasWritePrdCompleted) return false;
  const hasPrdDrafted = events.some((e) => e.kind === 'prd.drafted');
  if (hasPrdDrafted) return false;
  return !computeIsLive(events);
}
