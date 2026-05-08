import { z } from 'zod';

// QualityComponents matches Steve's verbatim list (08-learning-convergence-loop.md:105-119).
// snake_case for PlaybookManifest portability (#556).
// audit_score lives OUTSIDE components — it is informational only and does not
// feed computeQualityScore (per issue #565 spec).
export const QualityComponentsSchema = z.object({
  p0_count: z.number().int().min(0),
  p1_count: z.number().int().min(0),
  p2_count: z.number().int().min(0),
  p3_count: z.number().int().min(0),
  regressions_open: z.number().int().min(0),
  review_converged: z.boolean(),
  uat_passed: z.boolean(),
  static_passed: z.boolean(),
  harness_pass_rate: z.number().min(0).max(1),
});

export type QualityComponents = z.infer<typeof QualityComponentsSchema>;

// Input to computeQualityScore. The components come from the aggregated pipeline
// outputs: finding counts from QA/review, tier results from three-tier-verify,
// and harness_pass_rate from the test runner.
export interface RunArtifacts {
  runId: string;
  projectId: string;
  workItemId?: string | null;
  iteration?: number;
  components: QualityComponents;
  // audit_score from code-quality-audit (#564) — informational, not a component
  auditScore?: number | null;
}

export interface RunQualityScore {
  runId: string;
  projectId: string;
  iteration: number;
  score: number;
  components: QualityComponents;
  auditScore: number | null;
  ts: string;
}
