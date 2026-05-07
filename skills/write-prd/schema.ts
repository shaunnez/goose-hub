import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

// ─── Sub-schemas ───────────────────────────────────────────────────────────────

export const JourneyStepSchema = z.object({
  userAction: z.string(),
  systemResponse: z.string(),
  dataShown: z.string(),
  stateChange: z.string(),
});

export const JourneyErrorStateSchema = z.object({
  error: z.string(),
  recovery: z.string(),
});

export const JourneySchema = z.object({
  id: z.string(),
  persona: z.string(),
  trigger: z.string(),
  steps: z.array(JourneyStepSchema),
  successState: z.string(),
  errorStates: z.array(JourneyErrorStateSchema),
  edgeCases: z.array(z.string()),
});

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  statement: z.string(),
  journeyId: z.string().optional(),
  stepIdx: z.number().int().optional(),
  crossCutting: z.boolean().optional(),
  verifyCommand: z.string().optional(),
});

export const FunctionalSpecBehaviorSchema = z.object({
  when: z.string(),
  given: z.string(),
  // biome-ignore lint/suspicious/noThenProperty: schema mirrors when/given/then doctrine from #313
  then: z.string(),
});

export const FunctionalSpecStateSchema = z.object({
  state: z.string(),
  entryCondition: z.string(),
  behaviorsAvailable: z.array(z.string()),
  exitTransitions: z.array(z.string()),
});

export const FunctionalSpecInvalidTransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  reason: z.string(),
});

export const FunctionalSpecDataConstraintSchema = z.object({
  type: z.string(),
  validation: z.string(),
});

export const FunctionalSpecSchema = z.object({
  behaviors: z.array(FunctionalSpecBehaviorSchema),
  stateModel: z.array(FunctionalSpecStateSchema),
  invalidTransitions: z.array(FunctionalSpecInvalidTransitionSchema),
  dataConstraints: z.array(FunctionalSpecDataConstraintSchema),
});

export const SliceOutlineSchema = z.object({
  title: z.string(),
  goal: z.string(),
  estimatedSize: z.enum(['S', 'M', 'L']),
  journeyRefs: z.array(z.string()),
});

// ─── Top-level PRD schema ──────────────────────────────────────────────────────
//
// Orphaned-AC rule (per issue #313):
//   An entry in `acceptanceCriteria` whose `journeyId` is undefined AND whose
//   `crossCutting` is not strictly `true` is rejected. We do NOT check that
//   `journeyId` resolves to an entry in `journeys[]` — that is a stronger
//   refinement not required by the issue.

export const PRDOutputSchema = z
  .object({
    title: z.string(),
    problem: z.string(),
    proposedSolution: z.string(),
    outOfScope: z.array(z.string()),
    successCriteria: z.array(z.string()),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema),
    journeys: z.array(JourneySchema).min(1),
    functionalSpec: FunctionalSpecSchema,
    engineeringSpecRef: z.string().optional(),
    verticalSlices: z.array(SliceOutlineSchema).min(1),
    estimatedComplexity: z.enum(['low', 'medium', 'high']),
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  })
  .superRefine((data, ctx) => {
    for (let i = 0; i < data.acceptanceCriteria.length; i++) {
      const ac = data.acceptanceCriteria[i];
      const noJourney = ac.journeyId === undefined;
      const notCrossCutting = ac.crossCutting !== true;
      if (noJourney && notCrossCutting) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `acceptanceCriteria[${i}] (id="${ac.id}") has no journeyId and is not marked crossCutting:true — every AC must back-reference a journey or declare itself cross-cutting`,
          path: ['acceptanceCriteria', i],
        });
      }
    }
  });

export type PRDOutput = z.infer<typeof PRDOutputSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type FunctionalSpec = z.infer<typeof FunctionalSpecSchema>;
export type SliceOutline = z.infer<typeof SliceOutlineSchema>;
