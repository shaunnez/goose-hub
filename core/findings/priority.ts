import { z } from 'zod';

/**
 * Priority classification for a holdout-emitted finding (#697).
 *
 * Every QA and Review finding carries a `priority` so the per-cycle quality
 * score (`core/quality-score/`) can compute P0..P3 counts uniformly across
 * both holdouts. The shared schema lives here so QA and Review cannot drift.
 *
 * Semantics:
 * - `P0`: must-fix-before-merge. Zeros the per-cycle quality score outright.
 * - `P1`: significant defect. -8 per finding in the score formula.
 * - `P2`: notable issue. -4 per finding.
 * - `P3`: nit / informational. -1 per finding.
 *
 * When an agent does not set `priority` explicitly, the default mapping
 * helpers below promote `severity` to a sensible default:
 *   QA   error   → P1, warning → P2, info → P3
 *   Review blocker → P0, major   → P1, minor → P2
 */
export const PrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);

export type Priority = z.infer<typeof PrioritySchema>;

export const PRIORITIES: readonly Priority[] = PrioritySchema.options;

/**
 * Default QA severity → priority mapping. Used when a QA finding omits
 * `priority`.
 */
export function defaultQaPriority(severity: 'error' | 'warning' | 'info'): Priority {
  switch (severity) {
    case 'error':
      return 'P1';
    case 'warning':
      return 'P2';
    case 'info':
      return 'P3';
  }
}

/**
 * Default Review severity → priority mapping. Used when a Review finding
 * omits `priority`. Blockers are treated as P0 because they bar merge.
 */
export function defaultReviewPriority(severity: 'blocker' | 'major' | 'minor'): Priority {
  switch (severity) {
    case 'blocker':
      return 'P0';
    case 'major':
      return 'P1';
    case 'minor':
      return 'P2';
  }
}
