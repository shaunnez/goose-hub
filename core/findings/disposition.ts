import { z } from 'zod';

/**
 * Disposition for a holdout-emitted finding (#468).
 *
 * Every error-severity QA finding and every blocker-severity Review finding
 * MUST declare a disposition. The shared schema lives here so QA and Review
 * cannot drift; both skills' `FindingSchema` re-export and apply
 * `requireDispositionWhen` for their highest-severity tier.
 *
 * - `fixed`: already addressed in this PR. `dispositionRef` is a commit SHA.
 * - `needs-fix`: in scope for this story/PR and must enter the repair loop.
 * - `out-of-scope`: real observation, but not in scope for this issue.
 *   `dispositionRef` is a one-sentence rationale.
 * - `follow-up`: real observation intentionally outside this PR.
 *   `dispositionRef` is the follow-up issue number (e.g. `"#234"`).
 *
 * Holdout note: holdouts (QA, Review) only *record* the finding and chosen
 * disposition. They do not file the follow-up issue themselves — the
 * orchestrator or the human reviewer is responsible for actually filing
 * follow-up issues.
 */
export const DispositionSchema = z.enum(['fixed', 'needs-fix', 'out-of-scope', 'follow-up']);

export type Disposition = z.infer<typeof DispositionSchema>;

export const DISPOSITIONS: readonly Disposition[] = DispositionSchema.options;
