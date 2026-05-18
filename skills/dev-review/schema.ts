import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * Single dev-review finding. Evidence (`file` + `line`) is REQUIRED so the
 * developer can act on the report without re-reading the diff. Codex
 * routinely emits findings with file/line context; the schema enforces it.
 */
export const DevReviewFindingSchema = z.object({
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  category: z.enum(['correctness', 'security', 'edge-case', 'design', 'performance', 'other']),
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  summary: z.string().min(1),
  suggestion: z.string().min(1),
});

/**
 * Dev-review output. The verdict drives the implement workflow's one-pass
 * loop bound (M19.12):
 *
 *  - `no-blockers`   — proceed straight to QA
 *  - `blockers-found` — dev gets ONE additional turn to address; second
 *                       dev-review pass is hard-capped off
 *  - `inconclusive`  — Codex couldn't decide; treated as blockers-found
 *                      with conservative semantics
 *
 * `decisionSummaries` follow the canonical taxonomy. Findings without
 * file+line evidence fail validation by construction (schema-level).
 */
export const DevReviewOutputSchema = z.object({
  verdict: z.enum(['no-blockers', 'blockers-found', 'inconclusive']),
  findings: z.array(DevReviewFindingSchema),
  decisionSummaries: z.array(DecisionSummarySchema),
});

export const DevReviewContextSchema = z.object({
  /** The original GitHub issue — acceptance criteria the dev was working against. */
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  /** Git diff of the developer's work, ready for QA. */
  prDiff: z.string(),
  /**
   * Slice-level test files included in the change. Codex reads these to
   * verify the diff's claimed coverage matches what's there.
   */
  sliceTests: z.array(z.string()).optional(),
  /**
   * Project commands so Codex can suggest concrete reproduction steps in
   * findings (e.g. `pnpm test slices/<x>`).
   */
  projectCommands: z
    .object({
      testCommand: z.string().optional(),
      lintCommand: z.string().optional(),
      typecheckCommand: z.string().optional(),
    })
    .optional(),
  /**
   * Capped static-import signal for exported symbols changed by the diff.
   * These are likely consumers to inspect, not proof of affected behavior.
   */
  symbolImpact: z
    .array(
      z.object({
        changedExport: z.string(),
        definedIn: z.string(),
        importers: z.array(z.string()),
      }),
    )
    .optional(),
});

export type DevReviewFinding = z.infer<typeof DevReviewFindingSchema>;
export type DevReviewOutput = z.infer<typeof DevReviewOutputSchema>;
export type DevReviewContext = z.infer<typeof DevReviewContextSchema>;
