import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * A file path proposed by bug-enhance as a likely candidate for the
 * downstream investigation. `confidence` reflects whether the path was
 * tool-verified (high), pattern-matched against component/route indices
 * (medium), or inferred from the bug body alone (low).
 */
export const GroundedCandidateFileSchema = z.object({
  path: z.string().min(1).max(500),
  confidence: z.enum(['high', 'medium', 'low']),
  source: z
    .enum([
      'tool-verified',
      'route-index',
      'component-fuzzy',
      'recent-changes',
      'body-mention',
      'inferred',
    ])
    .optional(),
  reason: z.string().max(280).optional(),
});

export const GroundedCandidateComponentSchema = z.object({
  name: z.string().min(1).max(200),
  file: z.string().min(1).max(500).optional(),
});

export const GroundedCandidateRouteSchema = z.object({
  pattern: z.string().min(1).max(500),
  component: z.string().min(1).max(200).optional(),
});

/**
 * Structured grounding hints from bug-enhance. Persisted as the
 * `investigation-seed` artifact so downstream investigation and dev runs
 * start anchored to real files instead of brute-search.
 */
export const GroundedHintsSchema = z.object({
  candidateFiles: z.array(GroundedCandidateFileSchema).max(15).default([]),
  candidateComponents: z.array(GroundedCandidateComponentSchema).max(10).default([]),
  candidateRoutes: z.array(GroundedCandidateRouteSchema).max(10).default([]),
});

/**
 * Classification used to branch prompt behaviour and pick the right
 * grounding intents (route/component for ui-web, symbol/test for
 * server-api/cli/background, log/config for build-ci). `unknown` means the
 * agent could not place the bug after tool-verified inspection; downstream
 * will fall back to symbol-index identifier extraction.
 */
export const BugCategorySchema = z.enum([
  'ui-web',
  'server-api',
  'cli',
  'background',
  'build-ci',
  'unknown',
]);

export const BugEnhanceOutputSchema = z.object({
  enhancedContent: z
    .string()
    .describe('Structured markdown sections to append after the original bug body'),
  category: BugCategorySchema.optional(),
  groundedHints: GroundedHintsSchema.optional(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type BugEnhanceOutput = z.infer<typeof BugEnhanceOutputSchema>;
export type BugCategory = z.infer<typeof BugCategorySchema>;
export type GroundedHints = z.infer<typeof GroundedHintsSchema>;
export type GroundedCandidateFile = z.infer<typeof GroundedCandidateFileSchema>;
