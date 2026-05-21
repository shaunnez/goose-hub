export type AcceptanceContractSource = 'normalized' | 'engineering-spec' | 'prd' | 'issue-body';

export interface AcceptanceCriterionContract {
  id: string;
  statement: string;
  verifyCommand?: string;
  expected?: string;
  tolerance?: string;
  journeyRef?: string;
  stepIdx?: number;
  crossCutting?: boolean;
  sourceRef?: string;
}

export interface AcceptanceContract {
  source: AcceptanceContractSource;
  criteria: AcceptanceCriterionContract[];
  runId?: string | null;
  eventId?: number;
  createdAt?: string;
}

export interface VerifyCommandContract {
  ac: string;
  command: string;
  expected: string;
  tolerance: string;
}
