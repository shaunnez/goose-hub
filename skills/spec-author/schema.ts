import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const SpecAuthorSchema = z.object({
  specPath: z
    .string()
    .describe(
      'Workspace-relative path to the written Playwright spec, e.g. apps/web/e2e/<slug>.spec.ts',
    ),
  planSummary: z
    .string()
    .describe('One-paragraph summary of what the spec asserts and how it exercises the slice'),
  screenshotsTaken: z
    .number()
    .int()
    .min(0)
    .describe('Number of screenshots captured during exploration of the running dev server'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type SpecAuthorOutput = z.infer<typeof SpecAuthorSchema>;
