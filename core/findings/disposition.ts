import { z } from 'zod';

/**
 * Disposition for a holdout-emitted finding (#468).
 *
 * Every error-severity QA finding and every blocker-severity Review finding
 * MUST declare a disposition. The shared schema lives here so QA and Review
 * cannot drift; both skills' `FindingSchema` re-export and apply
 * `requireDispositionWhen` for their highest-severity tier.
 *
 * - `fixed`: addressed in this PR. `dispositionRef` is a commit SHA.
 * - `registered`: filed as a follow-up issue. `dispositionRef` is the issue
 *   number (e.g. `"#234"`).
 * - `out-of-scope`: not in scope for this issue. `dispositionRef` is a
 *   one-sentence rationale.
 *
 * Holdout note: holdouts (QA, Review) only *record* the finding and chosen
 * disposition. They do not file the follow-up issue themselves — the
 * orchestrator or the human reviewer is responsible for actually filing
 * `registered` issues.
 */
export const DispositionSchema = z.enum(['fixed', 'registered', 'out-of-scope']);

export type Disposition = z.infer<typeof DispositionSchema>;

export const DISPOSITIONS: readonly Disposition[] = DispositionSchema.options;
