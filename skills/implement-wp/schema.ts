import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * Output schema for the implement-wp skill (M19.03, ADR 0031).
 *
 * Mirrors `ImplementSchema` but omits the git-commit step and adds WP identity.
 * The orchestrator commits the builder's work after validating this output.
 */
export const ImplementWpSchema = z
  .object({
    wpId: z.string().min(1).describe('The Work Package id this builder was assigned'),
    plan: z
      .string()
      .min(1)
      .describe('The plan the builder wrote and executed (markdown, multi-line allowed)'),
    filesWritten: z.array(
      z.object({
        path: z.string().min(1).describe('Workspace-relative path written or modified'),
        reason: z.string().min(1).describe('Why this file was changed (one short sentence)'),
      }),
    ),
    testsWritten: z.array(
      z.object({
        path: z.string().min(1).describe('Workspace-relative path to the test file'),
        cases: z.number().int().min(0).describe('Number of test cases added or modified'),
      }),
    ),
    testsRun: z.object({
      command: z.string().min(1).describe('The test command actually invoked'),
      paths: z.array(z.string().min(1)).describe('Test file paths passed to the command'),
    }),
    confidence: z.enum(['low', 'medium', 'high']),
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  })
  .superRefine((val, ctx) => {
    if (val.testsWritten.length > 0 && val.testsRun.paths.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'testsRun.paths must be non-empty when testsWritten is non-empty (record what was actually run)',
        path: ['testsRun', 'paths'],
      });
    }
    const ownedPaths = new Set<string>();
    for (const f of val.filesWritten) {
      if (ownedPaths.has(f.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `filesWritten contains duplicate path: ${f.path}`,
          path: ['filesWritten'],
        });
      }
      ownedPaths.add(f.path);
    }
  });

export type ImplementWpOutput = z.infer<typeof ImplementWpSchema>;
