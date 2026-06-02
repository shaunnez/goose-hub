import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { CapConflict, WorkflowRouteDecision } from './types.js';

export function emitRouteSelected(input: {
  projectId: string;
  workItemId: string;
  route: WorkflowRouteDecision;
  runId?: string;
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'workflow.route-selected',
    payload: {
      tier: input.route.tier,
      source: input.route.source,
      budgetCaps: input.route.budgetCaps,
      evidence: input.route.evidence,
      escalationTriggers: input.route.escalationTriggers,
      requiresHumanApproval: input.route.requiresHumanApproval,
      rootCauseSignature: input.route.rootCauseSignature,
      selectedStages: input.route.selectedStages,
    },
    runId: input.runId,
  });
}

export function emitRouteConfirmed(input: {
  projectId: string;
  workItemId: string;
  route: WorkflowRouteDecision;
  runId?: string;
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'workflow.route-confirmed',
    payload: {
      tier: input.route.tier,
      source: input.route.source,
      budgetCaps: input.route.budgetCaps,
      evidence: input.route.evidence,
      escalationTriggers: input.route.escalationTriggers,
      requiresHumanApproval: input.route.requiresHumanApproval,
      rootCauseSignature: input.route.rootCauseSignature,
      selectedStages: input.route.selectedStages,
    },
    runId: input.runId,
  });
}

export function emitEscalationProposed(input: {
  projectId: string;
  workItemId: string;
  route: WorkflowRouteDecision;
  interventionId: string;
  runId?: string;
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'workflow.route-escalation-proposed',
    payload: {
      tier: input.route.tier,
      source: input.route.source,
      interventionId: input.interventionId,
      escalationTriggers: input.route.escalationTriggers,
      rootCauseSignature: input.route.rootCauseSignature,
    },
    runId: input.runId,
  });
}

export function emitCapApplied(input: {
  projectId: string;
  workItemId: string;
  conflict: CapConflict;
  runId?: string;
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'workflow.route-cap-applied',
    payload: {
      requiredTier: input.conflict.requiredTier,
      effectiveTier: input.conflict.effectiveTier,
      cappedBy: input.conflict.cappedBy,
      reason: input.conflict.reason,
      hasSensitivePath: input.conflict.hasSensitivePath,
    },
    runId: input.runId,
  });
}

export function loadLatestRoute(input: {
  projectId: string;
  workItemId: string;
}): WorkflowRouteDecision | null {
  const confirmed = eventStore.replay({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'workflow.route-confirmed',
    order: 'desc',
    limit: 1,
  });
  if (confirmed.length > 0) {
    return confirmed[0].payload as WorkflowRouteDecision;
  }

  const selected = eventStore.replay({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'workflow.route-selected',
    order: 'desc',
    limit: 1,
  });
  if (selected.length > 0) {
    return selected[0].payload as WorkflowRouteDecision;
  }

  return null;
}
