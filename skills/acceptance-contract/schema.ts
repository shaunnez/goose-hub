import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export const AcceptanceContractCriterionSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  verifyCommand: z.string().min(1).optional(),
  expected: z.string().min(1).optional(),
  tolerance: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
});

export const AcceptanceContractOutputSchema = z.object({
  criteria: z.array(AcceptanceContractCriterionSchema).min(1),
  issueBodyPatchRecommended: z.boolean().default(false),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type AcceptanceContractOutput = z.infer<typeof AcceptanceContractOutputSchema>;
