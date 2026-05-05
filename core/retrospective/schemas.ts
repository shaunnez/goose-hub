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

export const LearningEntrySchema = z.object({
  id: z.string(),
  sourceRunIds: z.array(z.string()).min(1),
  personaName: z.string(),
  role: z.string(),
  observation: z.string(),
  rationale: z.string(),
  improvementKind: ImprovementKindSchema,
  targetPath: z.string().optional(),
  confidence: ConfidenceSchema,
});

export const QualityScoreSchema = z.object({
  personaName: z.string(),
  role: z.string(),
  skillName: z.string(),
  score: z.number().min(0).max(1),
  trend: z.enum(['improving', 'stable', 'declining']),
  sampleCount: z.number().int().min(1),
  computedAt: z.string().datetime(),
});

export const DecisionPatternSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  frequency: z.number().int().min(1),
  confidence: ConfidenceSchema,
  exampleRunIds: z.array(z.string()).min(1),
  surfacedAt: z.string().datetime(),
});

export const DecisionSummarySchema = z.object({
  kind: DecisionKindSchema,
  summary: z.string(),
  evidence: z.string().optional(),
});

export const ImprovementCandidateSchema = z.object({
  kind: ImprovementKindSchema,
  targetPath: z.string(),
  sourceRunId: z.string(),
  sourceProject: z.string(),
  sourceWorkItem: z.string(),
  suggestionText: z.string(),
  confidence: ConfidenceSchema,
  proposedDiff: z.string().optional(),
});

export type LearningEntry = z.infer<typeof LearningEntrySchema>;
export type QualityScore = z.infer<typeof QualityScoreSchema>;
export type DecisionPattern = z.infer<typeof DecisionPatternSchema>;
export type ImprovementKind = z.infer<typeof ImprovementKindSchema>;
export type ImprovementCandidate = z.infer<typeof ImprovementCandidateSchema>;
export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;

// Patterns must reach this confidence level before surfacing as improvement candidates.
// Controlled convergence prevents low-signal noise from polluting the Roster.
export const CONVERGENCE_THRESHOLD = 'high' as const satisfies Confidence;
