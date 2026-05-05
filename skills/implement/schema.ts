import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const FileWrittenSchema = z.object({
  path: z.string().describe('Workspace-relative path to the file written or modified'),
  reason: z.string().describe('Why this file was changed (one short sentence)'),
});

export const TestWrittenSchema = z.object({
  path: z.string().describe('Workspace-relative path to the test file'),
  cases: z.number().int().min(0).describe('Number of test cases added / modified in this file'),
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
      .describe('Test files written or modified — empty array is valid for chore PRs without tests'),
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
      .describe('Workspace-relative spec path; required for any slice touching apps/web/, null otherwise'),
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

export type ImplementOutput = z.infer<typeof ImplementSchema>;
