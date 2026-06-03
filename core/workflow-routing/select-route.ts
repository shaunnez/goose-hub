import type {
  BudgetCaps,
  EscalationTrigger,
  RouteEvidence,
  RouteSignals,
  RouteSource,
  RouteStage,
  RouteTier,
  WorkflowRouteDecision,
} from './types.js';

const TIER_BUDGETS: Record<RouteTier, BudgetCaps> = {
  T0: { maxUsd: 0.3, maxScouts: 0, allowWave2: false, reviewerSlots: 1 },
  T1: { maxUsd: 0.8, maxScouts: 1, allowWave2: false, reviewerSlots: 1 },
  T2: { maxUsd: 2.0, maxScouts: 3, allowWave2: false, reviewerSlots: 1 },
  T3: { maxUsd: 6.0, maxScouts: 6, allowWave2: true, reviewerSlots: 2 },
  T4: { maxUsd: 0, maxScouts: 0, allowWave2: false, reviewerSlots: 1 },
};

const TIER_STAGES: Record<RouteTier, RouteStage[]> = {
  T0: ['triage', 'implement', 'qa', 'review', 'retro'],
  T1: ['triage', 'investigate', 'implement', 'qa', 'review', 'retro'],
  T2: ['triage', 'investigate', 'spec-author', 'implement', 'qa', 'review', 'retro'],
  T3: ['triage', 'investigate', 'spec-author', 'parallel-implement', 'qa', 'review', 'retro'],
  T4: ['triage'],
};

function tierOrdinal(tier: RouteTier): number {
  return ['T0', 'T1', 'T2', 'T3', 'T4'].indexOf(tier);
}

function maxTier(a: RouteTier, b: RouteTier): RouteTier {
  return tierOrdinal(a) >= tierOrdinal(b) ? a : b;
}

function preliminaryTier(signals: RouteSignals): { tier: RouteTier; reasons: string[] } {
  const reasons: string[] = [];

  if (signals.hasVagueOrHighRisk || signals.hasSensitivePath) {
    reasons.push(
      signals.hasVagueOrHighRisk ? 'vague or high-risk signal' : 'sensitive path detected',
    );
    return { tier: 'T3', reasons };
  }

  if (signals.hasSchemaSignal && signals.hasDependencySignal) {
    reasons.push('schema + dependency signals');
    return { tier: 'T3', reasons };
  }

  if (signals.hasSchemaSignal || signals.hasDependencySignal) {
    reasons.push(signals.hasSchemaSignal ? 'schema signal' : 'dependency signal');
    return { tier: 'T2', reasons };
  }

  if (
    signals.workItemType === 'bug' &&
    signals.seedFileCount != null &&
    signals.seedFileCount <= 3
  ) {
    reasons.push(`bug with ≤3 seed files (${signals.seedFileCount})`);
    return { tier: 'T1', reasons };
  }

  if (signals.workItemType === 'bug' && signals.seedFileCount == null) {
    reasons.push('bug with no seed — fail-safe up to T2');
    return { tier: 'T2', reasons };
  }

  reasons.push('no matching signals');
  return { tier: 'T0', reasons };
}

function confirmedTier(signals: RouteSignals): {
  tier: RouteTier;
  reasons: string[];
  escalationTriggers: EscalationTrigger[];
  requiresHumanApproval: boolean;
} {
  if (signals.investigationConfidence == null) {
    return {
      tier: 'T0',
      reasons: ['no investigation'],
      escalationTriggers: [],
      requiresHumanApproval: false,
    };
  }

  const reasons: string[] = [];
  const escalationTriggers: EscalationTrigger[] = [];
  let requiresHumanApproval = false;

  if (signals.investigationConfidence === 'low') {
    reasons.push('low confidence investigation');
    escalationTriggers.push({ kind: 'low-confidence-investigation', detail: 'confidence=low' });
    requiresHumanApproval = true;
    return { tier: 'T3', reasons, escalationTriggers, requiresHumanApproval };
  }

  if (signals.hasBlockingContradictions ?? signals.hasContradictions) {
    reasons.push('contradictions in investigation');
    escalationTriggers.push({ kind: 'contradictions-found', detail: 'contradictions > 0' });
    return { tier: 'T3', reasons, escalationTriggers, requiresHumanApproval };
  }

  if (signals.hasSensitivePath) {
    reasons.push('sensitive path detected in investigation');
    escalationTriggers.push({
      kind: 'sensitive-path-touched',
      detail: 'sensitive path in key files',
    });
    return { tier: 'T3', reasons, escalationTriggers, requiresHumanApproval };
  }

  if (
    (signals.nonTestFileCount != null && signals.nonTestFileCount >= 4) ||
    signals.wave2Triggered
  ) {
    const detail = signals.wave2Triggered
      ? 'wave2 triggered'
      : `${signals.nonTestFileCount} non-test files`;
    reasons.push(detail);
    return { tier: 'T3', reasons, escalationTriggers, requiresHumanApproval };
  }

  if (signals.nonTestFileCount != null && signals.nonTestFileCount >= 2) {
    reasons.push(`${signals.nonTestFileCount} non-test files`);
    return { tier: 'T2', reasons, escalationTriggers, requiresHumanApproval };
  }

  if (signals.investigationConfidence === 'high' && (signals.nonTestFileCount ?? 0) <= 1) {
    reasons.push('high confidence, ≤1 non-test file');
    return { tier: 'T1', reasons, escalationTriggers, requiresHumanApproval };
  }

  reasons.push('medium confidence or unclassified');
  return { tier: 'T2', reasons, escalationTriggers, requiresHumanApproval };
}

export function selectWorkflowRoute(
  signals: RouteSignals,
  source: RouteSource = 'metadata-only',
): WorkflowRouteDecision {
  const prelim = preliminaryTier(signals);
  const confirmed = confirmedTier(signals);
  const finalTier = maxTier(prelim.tier, confirmed.tier);

  const evidence: RouteEvidence = {
    reasons: [...prelim.reasons, ...confirmed.reasons],
    signals: signals as unknown as Record<string, unknown>,
  };

  const budgetCaps = TIER_BUDGETS[finalTier];
  const selectedStages: RouteStage[] = TIER_STAGES[finalTier];

  const rootCauseSignature = `route|${signals.workItemId}|workflow-routing`;

  return {
    tier: finalTier,
    selectedStages,
    budgetCaps,
    evidence,
    escalationTriggers: confirmed.escalationTriggers,
    requiresHumanApproval: confirmed.requiresHumanApproval,
    source,
    rootCauseSignature,
  };
}
