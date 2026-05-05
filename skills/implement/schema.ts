import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

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
 * Dev runs `<test_command> --run <paths…>` rather than the full suite — QA
 * runs the full suite and cross-references this against its own results
 * to flag failures outside the dev-touched surface as high-signal regressions.
 */
export const TestsRunSchema = z.object({
  command: z
    .string()
    .describe('The test command the developer actually invoked (without file path arguments)'),
  paths: z.array(z.string()).describe('Workspace-relative test file paths passed to the command'),
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
  });

export type TestsRun = z.infer<typeof TestsRunSchema>;
export type ImplementOutput = z.infer<typeof ImplementSchema>;
