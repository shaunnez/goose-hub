export type RouteTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export type RouteSource =
  | 'promotion'
  | 'lazy-enhance'
  | 'metadata-only'
  | 'investigation'
  | 'escalation'
  | 'resume';

export type RouteStage =
  | 'triage'
  | 'investigate'
  | 'spec-author'
  | 'implement'
  | 'parallel-implement'
  | 'qa'
  | 'review'
  | 'retro';

export interface BudgetCaps {
  maxUsd: number;
  maxScouts: number;
  allowWave2: boolean;
  reviewerSlots: number;
}

export interface RouteEvidence {
  reasons: string[];
  signals: Record<string, unknown>;
}

export type EscalationTriggerKind =
  | 'low-confidence-investigation'
  | 'contradictions-found'
  | 'sensitive-path-touched'
  | 'wp-count-exceeded'
  | 'cost-cap-approached'
  | 'qa-failed-twice';

export interface EscalationTrigger {
  kind: EscalationTriggerKind;
  detail: string;
}

export interface WorkflowRouteDecision {
  tier: RouteTier;
  selectedStages: RouteStage[];
  budgetCaps: BudgetCaps;
  evidence: RouteEvidence;
  escalationTriggers: EscalationTrigger[];
  requiresHumanApproval: boolean;
  source: RouteSource;
  rootCauseSignature: string;
}

export interface RouteSignals {
  workItemId: string;
  workItemType?: string | null;
  seedFileCount?: number | null;
  hasVagueOrHighRisk?: boolean;
  hasSensitivePath?: boolean;
  hasSchemaSignal?: boolean;
  hasDependencySignal?: boolean;
  // Post-investigation signals
  investigationConfidence?: 'low' | 'medium' | 'high' | null;
  nonTestFileCount?: number | null;
  hasContradictions?: boolean;
  hasBlockingContradictions?: boolean;
  wave2Triggered?: boolean;
}

export interface CapConflict {
  requiredTier: RouteTier;
  effectiveTier: RouteTier;
  cappedBy: string;
  reason: string;
  hasSensitivePath: boolean;
}

/** Regex for paths that require elevated scrutiny (auth, secrets, migrations, etc.) */
export const SENSITIVE_PATH_PATTERN =
  /\b(auth|authentication|authorization|session|secret|secrets|token|credential|credentials|migration|migrations|concurrency|concurrent|race|parallel|state[-\s]?machine|security|permission|permissions|encrypt|decrypt|crypto|key[-\s]?management)\b/i;
