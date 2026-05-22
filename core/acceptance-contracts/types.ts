import { z } from 'zod';

export type AcceptanceContractSource = 'normalized' | 'engineering-spec' | 'prd' | 'issue-body';

export const OutputExpectationSchema = z.object({
  mode: z.enum(['exact', 'contains', 'regex']),
  value: z.string().min(1),
});

export const ExecutableCheckSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  expectedExitCodes: z.array(z.number().int()).min(1).optional(),
  outputExpectation: OutputExpectationSchema.optional(),
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
  timeoutMs?: number;
}
