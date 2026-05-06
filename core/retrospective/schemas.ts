import { z } from 'zod';
import { DecisionKindSchema } from '../agent-runtime/decision-types.js';

export { DecisionKindSchema } from '../agent-runtime/decision-types.js';
export type { DecisionKind } from '../agent-runtime/decision-types.js';

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const ImprovementKindSchema = z.enum([
  'skill-prompt',
  'skill-schema',
  'skill-config',
  'global-config',
  'project-config',
  'persona',
  'workflow',
  'governance-suggestion',
]);

export const OutcomeSchema = z.enum(['success', 'failure', 'partial']);

export const SummarySchema = z.object({
  wentWell: z.string().min(1),
  didNotGoWell: z.string().min(1),
  architecturalTakeaway: z.string().min(1),
});

export const ImprovementCandidateSchema = z.object({
  kind: ImprovementKindSchema,
  targetPath: z.string(),
  suggestionText: z.string(),
  evidence: z.string().optional(),
  confidence: ConfidenceSchema,
  proposedDiff: z.string().optional(),
});

export const QualityScoreSchema = z.object({
  personaId: z.string(),
  score: z.number().min(0).max(1),
  trend: z.enum(['improving', 'stable', 'declining']),
  sampleCount: z.number().int().min(1),
  rationale: z.string().min(1),
});

export const LearningEntrySchema = z.object({
  observation: z.string().min(1),
  rationale: z.string().min(1),
  improvementKind: ImprovementKindSchema,
  targetPath: z.string().optional(),
  confidence: ConfidenceSchema,
});

export const DecisionPatternSchema = z.object({
  pattern: z.string().min(1),
  occurrences: z.number().int().min(1),
  confidence: ConfidenceSchema,
  note: z.string().optional(),
});

export const DecisionSummarySchema = z.object({
  kind: DecisionKindSchema,
  summary: z.string(),
  evidence: z.string().optional(),
});

export const RetroOutputBaseSchema = z.object({
  outcome: OutcomeSchema,
  workItemNumber: z.number().int(),
  summary: SummarySchema,
  improvementCandidates: z.array(ImprovementCandidateSchema),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type Summary = z.infer<typeof SummarySchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type LearningEntry = z.infer<typeof LearningEntrySchema>;
export type QualityScore = z.infer<typeof QualityScoreSchema>;
export type DecisionPattern = z.infer<typeof DecisionPatternSchema>;
export type ImprovementKind = z.infer<typeof ImprovementKindSchema>;
export type ImprovementCandidate = z.infer<typeof ImprovementCandidateSchema>;
export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type RetroOutputBase = z.infer<typeof RetroOutputBaseSchema>;

// Patterns must reach this confidence level before surfacing as improvement candidates.
// Controlled convergence prevents low-signal noise from polluting the Roster.
export const CONVERGENCE_THRESHOLD = 'high' as const satisfies Confidence;
