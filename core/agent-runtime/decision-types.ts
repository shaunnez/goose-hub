import { z } from 'zod';

/**
 * Controlled vocabulary for `DecisionSummary.kind` (FACTORY_RULES rule 6).
 *
 * Three groups:
 *  - Cross-cutting decisions — apply to any role
 *  - Phase markers — TDD-loop / verification-tier checkpoints
 *  - Self-observations — the agent reporting on its own state
 *
 * `summary` remains free text. `kind` is the group-by key retro uses to
 * compare decisions across the corpus (M10+).
 */
export const DecisionKindSchema = z.enum([
  // Cross-cutting decisions
  'MODEL_SELECTION',
  'SCOPE_CHANGE',
  'FIX_STRATEGY',
  'SKIP_GATE',
  'ESCALATE',

  // Phase markers
  'READ',
  'PLAN',
  'RED',
  'GREEN',
  'REFACTOR',
  'LINT',
  'COMMIT',
  'STRUCTURAL_CHECK',
  'FUNCTIONAL_CHECK',
  'REGRESSION_CHECK',
  'CRITERIA_CHECK',
  'QUALITY_SCORE',
  'DIFF_READ',
  'VERDICT',

  // Self-observations
  'TOOL_FAILURE',
  'RETRY',
  'BLOCKER',
  'INSIGHT',
  'UNCERTAINTY',
  'DEFERRED',

  // Discontinuity marker for events recorded before the taxonomy existed.
  'UNKNOWN',
]);

export type DecisionKind = z.infer<typeof DecisionKindSchema>;

export const DECISION_KINDS: readonly DecisionKind[] = DecisionKindSchema.options;

/** True if `value` is a member of the canonical decision-kind enum. */
export function isDecisionKind(value: unknown): value is DecisionKind {
  return typeof value === 'string' && (DECISION_KINDS as readonly string[]).includes(value);
}
