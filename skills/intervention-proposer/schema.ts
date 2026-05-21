import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

const ManualTransitionPayloadSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  reason: z.string().min(1).optional(),
});

const ReasonPayloadSchema = z.object({
  reason: z.string().min(1).optional(),
});

const RequiredReasonPayloadSchema = z.object({
  reason: z.string().min(1),
});

const InterventionProposalPayloadSchema = z.union([
  ManualTransitionPayloadSchema,
  ReasonPayloadSchema,
  RequiredReasonPayloadSchema,
]);

export const InterventionProposalOptionSchema = z.object({
  actionType: z.enum([
    'manual_transition',
    'approve_gate',
    'reject_gate',
    'resume_workflow',
    'resolve_conflict',
    'no_action',
  ]),
  label: z.string().min(1),
  description: z.string().min(1),
  payload: InterventionProposalPayloadSchema,
  risk: z.enum(['low', 'medium', 'high']),
});

export const InterventionProposerOutputSchema = z.object({
  summary: z.string().min(1),
  options: z.array(InterventionProposalOptionSchema).min(1),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export const InterventionProposerContextSchema = z.object({
  intervention: z.object({
    id: z.string(),
    projectId: z.string(),
    workItemId: z.string(),
    interventionType: z.enum([
      'needs_human',
      'gate_pending',
      'merge_conflict',
      'qa_disagreement',
      'manual_override',
    ]),
    title: z.string(),
    reason: z.string(),
    rootCauseSignature: z.string(),
    sourceEventId: z.number().nullable(),
  }),
  workItem: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      number: z.number().optional(),
      state: z.string().optional(),
    })
    .optional(),
  recentEvents: z.array(z.unknown()).optional(),
  legalTargets: z.array(z.string()).optional(),
});

export type InterventionProposerOutput = z.infer<typeof InterventionProposerOutputSchema>;
export type InterventionProposerContext = z.infer<typeof InterventionProposerContextSchema>;
