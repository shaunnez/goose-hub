import { type AgentEvent, eventStore } from '../event-stream/store.js';
import { open } from './reducer.js';
import { findLatestByRootCause, isClosedStatus } from './repository.js';
import type { InterventionReducerResult, InterventionType } from './types.js';

export interface ProjectInterventionResult {
  opened: InterventionReducerResult | null;
  shouldScheduleProposer: boolean;
}

function causedByIntervention(payload: unknown): boolean {
  if (payload == null || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record.interventionId === 'string' || typeof record.causedByInterventionId === 'string'
  );
}

function signatureParts(event: AgentEvent): string[] {
  const payload = event.payload as Record<string, unknown>;
  return [
    event.projectId,
    event.workItemId ?? '',
    event.kind,
    typeof payload.from === 'string' ? payload.from : '',
    typeof payload.to === 'string' ? payload.to : '',
    typeof payload.reason === 'string' ? payload.reason : '',
  ];
}

export function classifyActionableEvent(
  event: AgentEvent,
): { interventionType: InterventionType; title: string; reason: string } | null {
  if (event.workItemId == null || causedByIntervention(event.payload)) return null;

  const payload = event.payload as Record<string, unknown>;
  if (event.kind === 'gate.awaiting-human') {
    return {
      interventionType: 'needs_human',
      title: 'Human input requested',
      reason:
        typeof payload.reason === 'string'
          ? payload.reason
          : 'Workflow is awaiting a human decision.',
    };
  }
  if (event.kind === 'merge.conflict' || event.kind === 'merge.conflict-unresolvable') {
    return {
      interventionType: 'merge_conflict',
      title: 'Merge conflict requires operator action',
      reason: 'A merge conflict blocked automatic progress.',
    };
  }
  if (event.kind === 'qa.tier-disagreement') {
    return {
      interventionType: 'qa_disagreement',
      title: 'QA evidence disagreement',
      reason: 'Deterministic verification and reported QA evidence disagreed.',
    };
  }
  if (event.kind === 'state.transitioned') {
    if (payload.to === 'factory:needs-human') {
      return {
        interventionType: 'needs_human',
        title: 'Issue moved to needs-human',
        reason: 'The lifecycle state requires operator intervention.',
      };
    }
    if (payload.to === 'factory:gate-pending') {
      return {
        interventionType: 'gate_pending',
        title: 'Gate pending',
        reason: 'The issue is waiting at a human gate.',
      };
    }
    if (payload.to === 'factory:merge-conflict') {
      return {
        interventionType: 'merge_conflict',
        title: 'Merge conflict state reached',
        reason: 'The issue is blocked on merge conflict resolution.',
      };
    }
  }
  return null;
}

export function projectActionableEvent(event: AgentEvent): ProjectInterventionResult {
  const classified = classifyActionableEvent(event);
  if (classified == null || event.workItemId == null) {
    return { opened: null, shouldScheduleProposer: false };
  }
  const rootCauseSignature = signatureParts(event).join('|');
  const existing = findLatestByRootCause({
    projectId: event.projectId,
    workItemId: event.workItemId,
    rootCauseSignature,
  });
  const opened = open({
    projectId: event.projectId,
    workItemId: event.workItemId,
    interventionType: classified.interventionType,
    title: classified.title,
    reason: classified.reason,
    rootCauseSignature,
    sourceEventId: event.id,
    actor: 'projector',
    evidence: { eventId: event.id, kind: event.kind, payload: event.payload },
  });
  const openedOrReopened = existing == null || isClosedStatus(existing.status);
  return {
    opened,
    shouldScheduleProposer:
      opened.ok &&
      openedOrReopened &&
      opened.intervention.status === 'OPEN' &&
      opened.intervention.sourceEventId === event.id,
  };
}

export function startInterventionProjector(): () => void {
  return eventStore.subscribe((event) => {
    projectActionableEvent(event);
  });
}

export function replayInterventionProjector(
  filter: {
    projectId?: string;
    workItemId?: string;
    sinceId?: number;
  } = {},
): ProjectInterventionResult[] {
  return eventStore.replay(filter).map((event) => projectActionableEvent(event));
}
