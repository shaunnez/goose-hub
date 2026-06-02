import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { CapConflict, RouteTier, WorkflowRouteDecision } from './types.js';

const TIER_RANK: Record<RouteTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
};

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
  const selected = eventStore.replay({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'workflow.route-selected',
    order: 'desc',
    limit: 1,
  });

  const confirmedRoute =
    confirmed.length > 0 ? (confirmed[0].payload as WorkflowRouteDecision) : null;
  const selectedRoute = selected.length > 0 ? (selected[0].payload as WorkflowRouteDecision) : null;

  if (confirmedRoute == null) return selectedRoute;
  if (selectedRoute == null) return confirmedRoute;

  return TIER_RANK[selectedRoute.tier] > TIER_RANK[confirmedRoute.tier]
    ? selectedRoute
    : confirmedRoute;
}
