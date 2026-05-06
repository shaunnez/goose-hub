import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';

export type Confidence = 'low' | 'medium' | 'high';
export type Outcome = 'success' | 'failure' | 'partial';
export type ImprovementKind =
  | 'skill-prompt'
  | 'skill-schema'
  | 'skill-config'
  | 'global-config'
  | 'project-config'
  | 'persona'
  | 'workflow'
  | 'governance-suggestion';

export interface Summary {
  wentWell: string;
  didNotGoWell: string;
  architecturalTakeaway: string;
}

export interface ImprovementCandidate {
  kind: ImprovementKind;
  targetPath: string;
  suggestionText: string;
  evidence?: string;
  confidence: Confidence;
  proposedDiff?: string;
}

export interface DecisionSummaryEntry {
  kind: string;
  summary: string;
  evidence?: string;
}

export interface QualityScore {
  personaId: string;
  score: number;
  trend: 'improving' | 'stable' | 'declining';
  sampleCount: number;
  rationale?: string;
}

export interface LearningEntry {
  observation: string;
  rationale: string;
  improvementKind: ImprovementKind;
  targetPath?: string;
  confidence: Confidence;
}

export interface DecisionPattern {
  pattern: string;
  occurrences: number;
  confidence: Confidence;
  note?: string;
}

export interface RetroOutputBase {
  outcome: Outcome;
  workItemNumber: number;
  summary: Summary;
  improvementCandidates: ImprovementCandidate[];
  decisionSummaries: DecisionSummaryEntry[];
}

export interface LightRetroPayload {
  tier: 'light';
  output: RetroOutputBase;
}

export interface DeepRetroPayload {
  tier: 'deep';
  output: RetroOutputBase & {
    triggerReasons: string[];
    personaQualityScores: QualityScore[];
    learningEntries: LearningEntry[];
    decisionPatterns: DecisionPattern[];
  };
}

export type RetroPayload = LightRetroPayload | DeepRetroPayload;

export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  low: 'bg-blue-500/15 text-blue-400',
};

export function scoreGrade(score: number): { label: string; color: string } {
  if (score >= 0.9) return { label: 'Excellent', color: 'var(--success)' };
  if (score >= 0.8) return { label: 'Strong', color: 'var(--success)' };
  if (score >= 0.7) return { label: 'Solid', color: 'var(--accent)' };
  if (score >= 0.6) return { label: 'Mixed', color: 'var(--warning)' };
  return { label: 'Concerning', color: 'var(--danger)' };
}

export function outcomeMeta(outcome: Outcome) {
  if (outcome === 'success')
    return { icon: CheckCircle, color: 'var(--success)', label: 'Success' };
  if (outcome === 'failure') return { icon: XCircle, color: 'var(--danger)', label: 'Failure' };
  return { icon: AlertCircle, color: 'var(--warning)', label: 'Partial' };
}
