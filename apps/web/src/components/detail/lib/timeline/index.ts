import type { AgentEventDto } from '@/lib/types';
import {
  TIMELINE_SECTION_DEFINITIONS,
  type TimelineSectionId,
  buildTimelineRunMetadataIndex,
  resolveTimelineSection,
} from '@goose-hub/core/workflows/timeline-sections.js';
import { buildInterventionGroup } from './interventions';
import { isGrillReplyManualAction, normalizeAgentLogEvent } from './log-events';
import { groupByContractPhase } from './phases/contract';
import {
  type DiscoverSessionRunIndex,
  discoverIndexKey,
  eventDiscoverPhase,
  getDiscoverPhaseId,
  getDiscoverSessionId,
  groupByDiscoverPhase,
  groupByDiscoverPhaseWithSessionIndex,
} from './phases/discover';
import { groupByInvestigationPhase } from './phases/investigation';
import {
  collectRunIdsForTimelineSection,
  compareRenderItems,
  compareTopLevelTimelineItems,
  eventFromRenderItem,
  extractPhaseTimes,
  extractTimelineSectionTimes,
  hasLiveRunGroup,
  sortTimelineChildrenForReading,
} from './render-items';
import { collapseLogRuns, extractRunMeta, groupByRunId } from './run-groups';
import type { InterventionTimelineDetail, RenderItem } from './types';

export { formatDuration, formatSkillName, getPayloadStr } from './format';
export { EVENT_KIND_LABEL } from './labels';
export {
  getAgentLogDisplayText,
  isCodexTransportWarningLog,
  normalizeAgentLogEvent,
} from './log-events';
export { VISIBLE_INTERVENTION_EVENT_TYPES } from './interventions';
export { groupByContractPhase } from './phases/contract';
export { groupByDiscoverPhase } from './phases/discover';
export { groupByInvestigationPhase } from './phases/investigation';
export { collectRunIdsForTimelineSection } from './render-items';
export { computeIsLive, computeIsWritePrdStuck } from './state';
export type { InterventionTimelineDetail, RenderItem, TimelineContext } from './types';

// ─── grouping ────────────────────────────────────────────────────────────────

export function groupByDevPhase(items: RenderItem[]): RenderItem[] {
  return groupByDevPhaseWithPipelineIndex(
    items,
    buildImplementationPipelineRunIndex(items.flatMap(eventFromRenderItem)),
  );
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
      event.kind === 'parallel-implement.wp-terminal-blocked' ||
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
  const specAuthorRepairByRunId = buildSpecAuthorRepairRunIndex(normalizedEvents);
  const segments = buildTimelineSegments(
    normalizedEvents,
    runMetadata,
    implementationPipelineByRunId,
    reviewWorkflowByRunId,
    discoverSessionByWorkflowOrRunId,
    fixFeedbackAttemptByRunId,
    prdWorkflowByRevisionEventId,
    specAuthorRepairByRunId,
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
  specAuthorRepairByRunId: ReadonlyMap<string, string>,
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
      specAuthorRepairByRunId,
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
  specAuthorRepairByRunId: ReadonlyMap<string, string>,
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
      return specAuthorRepairByRunId.get(runId ?? '') ?? pipelineRunId ?? workflowRunId ?? runId;
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
  for (const marker of [':scout:', ':bug-enhance']) {
    const markerIndex = runId.indexOf(marker);
    if (markerIndex > 0) return runId.slice(0, markerIndex);
  }
  return null;
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

function buildSpecAuthorRepairRunIndex(events: AgentEventDto[]): Map<string, string> {
  const repairByRunId = new Map<string, string>();

  for (const event of events) {
    if (event.kind !== 'agent.run-started') continue;
    if (eventSkill(event) !== 'spec-author') continue;
    if (eventPayloadString(event, 'attempt') !== 'repair') continue;
    const runId = event.runId;
    const repairOf = eventPayloadString(event, 'repairOf');
    if (runId == null || runId.trim() === '' || repairOf == null) continue;
    repairByRunId.set(runId, repairOf);
  }

  return repairByRunId;
}

function buildFixFeedbackAttemptRunIndex(events: AgentEventDto[]): Map<string, string> {
  const attemptByRunId = new Map<string, string>();
  const attemptIds = new Set<string>();

  for (const event of events) {
    if (!isFixFeedbackRelatedEvent(event)) continue;
    const attemptId = eventPayloadString(event, 'attemptId');
    if (event.runId != null && event.runId.trim() !== '') {
      attemptByRunId.set(event.runId, attemptId ?? event.runId);
    }
    if (attemptId == null) continue;
    attemptIds.add(attemptId);
  }

  for (const event of events) {
    if (event.kind !== 'agent.retry-escalated') continue;
    const originalRunId = eventPayloadString(event, 'runId');
    const retryRunId = eventPayloadString(event, 'retryRunId');
    if (originalRunId == null || retryRunId == null) continue;
    const attemptId = attemptByRunId.get(originalRunId);
    if (attemptId != null) attemptByRunId.set(retryRunId, attemptId);
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
  const attemptId =
    eventPayloadString(event, 'attemptId') ??
    (event.runId == null ? null : (fixFeedbackAttemptByRunId.get(event.runId) ?? null));
  if (attemptId != null) return `fix-feedback:${attemptId}`;
  if (!isFixFeedbackRelatedEvent(event)) return null;
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
  if (
    section === 'implementation' &&
    item.kind === 'phase-group' &&
    item.phase === 'dev' &&
    item.items.length <= 1
  ) {
    return item.items;
  }
  if (section === 'review' && item.kind === 'review-group') return item.items;
  return items;
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

const GRILL_ACTIVE_STATES = new Set(['factory:gate-pending', 'factory:grilling']);

function hasGrillActivity(events: AgentEventDto[]): boolean {
  return events.some(
    (event) => event.kind === 'question.asked' || eventSkill(event) === 'grill-me',
  );
}

function getOrderedEvents(events: AgentEventDto[]): AgentEventDto[] {
  return [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id,
  );
}

function getTransitionDestination(event: AgentEventDto): string | null {
  if (event.kind !== 'state.transitioned') return null;
  const payload = event.payload as { to?: string; toState?: string } | null;
  return payload?.to ?? payload?.toState ?? null;
}

function findAnsweredGrillResumeIndex(orderedEvents: AgentEventDto[]): number {
  const latestQuestionIndex = orderedEvents.findLastIndex(
    (event) => event.kind === 'question.asked',
  );
  if (latestQuestionIndex < 0) return -1;

  return orderedEvents.findIndex(
    (event, index) =>
      index > latestQuestionIndex && getTransitionDestination(event) === 'factory:grilling',
  );
}

function hasCompletedAnsweredGrillFlow(events: AgentEventDto[]): boolean {
  if (!hasGrillActivity(events)) return false;
  const orderedEvents = getOrderedEvents(events);
  const answeredResumeIndex = findAnsweredGrillResumeIndex(orderedEvents);
  if (answeredResumeIndex < 0) return false;

  return orderedEvents.some((event, index) => {
    if (index <= answeredResumeIndex) return false;
    const destination = getTransitionDestination(event);
    return (
      destination != null &&
      !GRILL_ACTIVE_STATES.has(destination) &&
      destination !== 'factory:needs-human'
    );
  });
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
  if (hasCompletedAnsweredGrillFlow(events)) {
    return 'completed';
  }
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
