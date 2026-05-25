import { z } from 'zod';

export type AcceptanceContractSource = 'normalized' | 'engineering-spec' | 'prd' | 'issue-body';

export const OutputExpectationSchema = z.object({
  mode: z.enum(['exact', 'contains', 'regex']),
  value: z.string().min(1),
});

export const EvidenceExpectationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exit-code') }),
  z.object({
    type: z.literal('vitest-json'),
    suite: z.string().min(1).optional(),
    testName: z.string().min(1).optional(),
    expectedStatus: z.literal('passed'),
  }),
]);

export const ExecutableCheckSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  expectedExitCodes: z.array(z.number().int()).min(1).optional(),
  /** Deprecated metadata. Kept for old authored contracts; not used as pass/fail truth. */
  outputExpectation: OutputExpectationSchema.optional(),
  evidenceExpectation: EvidenceExpectationSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  kind: z.enum(['unit', 'integration', 'e2e', 'api', 'lint', 'typecheck', 'custom']).optional(),
});

export const AcceptanceCriterionContractSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  sourceRef: z.string().min(1).optional(),
  journeyRef: z.string().min(1).nullable().optional(),
  stepIdx: z.number().int().nonnegative().nullable().optional(),
  crossCutting: z.boolean().nullable().optional(),
  executableChecks: z.array(ExecutableCheckSchema).optional(),
});

export type OutputExpectation = z.infer<typeof OutputExpectationSchema>;
export type EvidenceExpectation = z.infer<typeof EvidenceExpectationSchema>;
export type ExecutableCheck = z.infer<typeof ExecutableCheckSchema>;
export type AcceptanceCriterionContract = z.infer<typeof AcceptanceCriterionContractSchema>;

export interface AcceptanceContract {
  source: AcceptanceContractSource;
  criteria: AcceptanceCriterionContract[];
  runId?: string | null;
  eventId?: number;
  createdAt?: string;
}

export interface VerifyCommandContract {
  criterionId: string;
  checkId: string;
  ac: string;
  command: string;
  expectedExitCodes: number[];
  outputExpectation?: OutputExpectation;
  evidenceExpectation?: EvidenceExpectation;
  timeoutMs?: number;
}
