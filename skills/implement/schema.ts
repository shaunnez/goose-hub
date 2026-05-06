import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';
import { QualityScoresSchema, computeOverallScore } from '../qa/schema.js';

export { computeOverallScore };

export function anyZeroCategory(scores: z.infer<typeof QualityScoresSchema>): boolean {
  return Object.values(scores).some((v) => v === 0);
}

export { DecisionSummarySchema };

const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const FileWrittenSchema = z.object({
  path: z.string().describe('Workspace-relative path to the file written or modified'),
  reason: z.string().describe('Why this file was changed (one short sentence)'),
});

export const TestWrittenSchema = z.object({
  path: z.string().describe('Workspace-relative path to the test file'),
  cases: z.number().int().min(0).describe('Number of test cases added / modified in this file'),
});

/**
 * Records the targeted test command the developer actually ran (#467).
 * Dev runs `<test_command>  <paths…>` rather than the full suite — QA
 * runs the full suite and cross-references this against its own results
 * to flag failures outside the dev-touched surface as high-signal regressions.
 */
export const TestsRunSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe('The test command the developer actually invoked (without file path arguments)'),
  paths: z
    .array(z.string().min(1))
    .describe('Workspace-relative test file paths passed to the command'),
});

export const ImplementSchema = z
  .object({
    plan: z
      .string()
      .min(1)
      .describe('The plan the developer wrote and executed (markdown, multi-line allowed)'),
    filesWritten: z.array(FileWrittenSchema),
    testsWritten: z
      .array(TestWrittenSchema)
      .describe(
        'Test files written or modified — empty array is valid for chore PRs without tests',
      ),
    testsRun: TestsRunSchema.describe(
      'The targeted test command the developer ran, plus the file paths passed to it',
    ),
    prUrl: z
      .string()
      .url()
      .describe('URL of the pull request opened by the workflow after this skill returns'),
    /**
     * Workspace-relative path to the Playwright spec for the evidence-post skill (#234).
     * Required when any file in filesWritten is under apps/web/ — the superRefine below
     * enforces this. Null only for backend-only or chore PRs with no web files.
     */
    evidenceSpecPath: z
      .string()
      .nullable()
      .describe(
        'Workspace-relative spec path; required for any slice touching apps/web/, null otherwise',
      ),
    confidence: ConfidenceSchema,
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
    selfQualityScore: QualityScoresSchema.optional().describe(
      '8-category quality score the developer self-assigned; absent for chore PRs',
    ),
    selfScoreBelowThreshold: z
      .boolean()
      .optional()
      .describe('true when final self-score fails threshold (< 70) or single-zero rule'),
    selfScoreWarnings: z
      .array(z.string())
      .default([])
      .describe(
        'Non-fatal consistency warnings from superRefine (confidence vs threshold contradictions)',
      ),
  })
  .superRefine((val, ctx) => {
    const touchesWeb = val.filesWritten.some((f) => f.path.startsWith('apps/web/'));
    if (touchesWeb && val.evidenceSpecPath === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'evidenceSpecPath is required when filesWritten includes apps/web/ files',
        path: ['evidenceSpecPath'],
      });
    }
    // #467 — empty testsRun.paths is only valid when no test files were
    // written. A non-empty testsWritten with `paths: []` means dev wrote
    // tests but reported running none — that's a mis-shaped record, not a
    // valid chore PR.
    if (val.testsWritten.length > 0 && val.testsRun.paths.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'testsRun.paths must be non-empty when testsWritten is non-empty (record what dev actually ran, #467)',
        path: ['testsRun', 'paths'],
      });
    }
    // Soft warning: below threshold but claiming high confidence
    if (val.selfScoreBelowThreshold === true && val.confidence === 'high') {
      val.selfScoreWarnings.push(
        'selfScoreBelowThreshold is true but confidence is high — contradictory',
      );
    }
    // Soft warning: threshold passed but claiming low confidence
    if (val.selfScoreBelowThreshold === false && val.confidence === 'low') {
      val.selfScoreWarnings.push(
        'selfScoreBelowThreshold is false but confidence is low — contradictory',
      );
    }
    // Hard-fail: score tuple inconsistent with flag
    if (val.selfQualityScore != null && val.selfScoreBelowThreshold != null) {
      const score = computeOverallScore(val.selfQualityScore);
      const hasZero = anyZeroCategory(val.selfQualityScore);
      const shouldBeBelow = score < 70 || hasZero;
      if (shouldBeBelow !== val.selfScoreBelowThreshold) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `selfScoreBelowThreshold (${val.selfScoreBelowThreshold}) is inconsistent with selfQualityScore (aggregate ${score}, anyZero ${hasZero})`,
          path: ['selfScoreBelowThreshold'],
        });
      }
    }
  });

export type TestsRun = z.infer<typeof TestsRunSchema>;
export type ImplementOutput = z.infer<typeof ImplementSchema>;
