import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * Engineering Spec schema (M19.02, issue #559).
 *
 * Source of truth: Steve `01-planning-phase.md:282-327` Step 7 + 7b
 * (Engineering Specification + Constraint Inventory). Worked examples in
 * `docs/steves-training-materials/Plan Examples/`.
 *
 * Authored by the `spec-author` skill; consumed by parallel-builder
 * (M19.03) and convergent-review (M19.04). The file-ownership rule and
 * grounding-in-real-code rules are what make parallel build *safe*.
 */

export const BuilderTierSchema = z.enum(['opus', 'sonnet', 'haiku']);
export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export const ConstraintKindSchema = z.enum(['phase', 'gate', 'hook', 'model', 'output-format']);
export const CONSTRAINT_SOURCE_PATTERN = /^([^\s:]+):(\d+|[A-Za-z_][\w-]*)$/;
export const ConstraintSourceSchema = z.string().regex(CONSTRAINT_SOURCE_PATTERN, {
  message:
    'Use exactly path/to/file.ts:123 or path/to/file.ts:SymbolName; do not use line ranges or SYMBOL: prefixes',
});

const optionalAiString = z.string().min(1).nullable().optional();
const optionalAiNumber = z.number().int().nonnegative().nullable().optional();
const optionalAiBoolean = z.boolean().nullable().optional();

export const JourneyStepSchema = z.object({
  idx: z.number().int().nonnegative(),
  description: z.string().min(1),
});

export const JourneySchema = z.object({
  id: z.string().min(1),
  actor: z.string().min(1),
  steps: z.array(JourneyStepSchema).min(1),
});

export const FunctionalRequirementSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
});

export const ArchitectureSchema = z.object({
  current: z.string().min(1),
  new: z.string().min(1),
  decisionRationale: z.string().min(1),
});

export const SchemaChangesSchema = z.object({
  /** Verbatim DDL — no pseudocode. Empty array if no schema changes. */
  ddl: z.array(z.string()),
  /** Migration files (relative paths). */
  migrations: z.array(z.string()),
});

export const InterfaceContractSchema = z.object({
  name: z.string().min(1),
  /** Paste-ready signature: function declaration, type alias, or full Zod block. */
  signature: z.string().min(1),
  /** Workspace-relative file the signature lives in (or will live in). */
  file: z.string().min(1),
  /** Optional `start-end` line range as a string, e.g. "12-34". */
  lineRange: optionalAiString,
});

export const WorkPackageSchema = z.object({
  id: z.string().min(1),
  /** Paths this WP owns. No path may appear in two WPs (full-stop, not per-batch). */
  filesOwned: z.array(z.string().min(1)).min(1),
  /** Description of changes — file:line citations encouraged. */
  changes: z.string().min(1),
  /** WP ids this WP depends on; must reference real WPs in the spec. */
  dependsOn: z.array(z.string()),
  builderTier: BuilderTierSchema,
});

export const ExecutionBatchSchema = z.object({
  batch: z.number().int().nonnegative(),
  wpIds: z.array(z.string().min(1)).min(1),
});

export const VerificationToolSchema = z.object({
  name: z.string().min(1),
  /** Workspace-relative path to the script that runs this verification. */
  scriptPath: z.string().min(1),
  /** Exit codes that count as success. */
  expectedExitCodes: z.array(z.number().int()).min(1),
  /** Optional input format spec (e.g. JSON schema for stdin). */
  inputSpec: optionalAiString,
});

export const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  /** Reference to a journey id; required unless `crossCutting: true`. */
  journeyRef: optionalAiString,
  /** Step index inside the journey (matches Journey.steps.idx). */
  stepIdx: optionalAiNumber,
  /** Falsifiable verification command — Steve "no subjective criteria". */
  verifyCommand: z.string().min(1),
  /** Optional tolerance string (numerical, time, etc). */
  tolerance: optionalAiString,
  /** When true, AC is exempt from the journey-coverage rule. */
  crossCutting: optionalAiBoolean,
  /** Origin of this AC. */
  source: z.enum(['user-journey', 'functional-requirement']).nullable().optional(),
});

export const ConstraintSchema = z.object({
  kind: ConstraintKindSchema,
  name: z.string().min(1),
  /**
   * Citation of the real code where this constraint comes from:
   * `path/to/file.ts:LINE` or `path/to/file.ts:SYMBOL`. Pseudo refs are
   * rejected by `validateEngineeringSpec`.
   */
  source: ConstraintSourceSchema,
});

export const RiskEntrySchema = z.object({
  risk: z.string().min(1),
  mitigation: z.string().min(1),
  severity: SeveritySchema,
});

export const EngineeringSpecSchema = z.object({
  objective: z.string().min(1),
  userJourneys: z.array(JourneySchema),
  functionalRequirements: z.array(FunctionalRequirementSchema),
  architecture: ArchitectureSchema,
  schemaChanges: SchemaChangesSchema,
  interfaceContracts: z.array(InterfaceContractSchema),
  workPackages: z.array(WorkPackageSchema).min(1),
  executionOrder: z.array(ExecutionBatchSchema).min(1),
  verificationTooling: z.array(VerificationToolSchema),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  constraints: z.array(ConstraintSchema),
  riskRegister: z.array(RiskEntrySchema),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type BuilderTier = z.infer<typeof BuilderTierSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type FunctionalRequirement = z.infer<typeof FunctionalRequirementSchema>;
export type WorkPackage = z.infer<typeof WorkPackageSchema>;
export type ExecutionBatch = z.infer<typeof ExecutionBatchSchema>;
export type VerificationTool = z.infer<typeof VerificationToolSchema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type Constraint = z.infer<typeof ConstraintSchema>;
export type RiskEntry = z.infer<typeof RiskEntrySchema>;
export type EngineeringSpec = z.infer<typeof EngineeringSpecSchema>;

// Backwards-compatible alias — old name retained so external imports
// (none in repo, but kept for safety) don't break.
export const SpecAuthorSchema = EngineeringSpecSchema;
export type SpecAuthorOutput = EngineeringSpec;
