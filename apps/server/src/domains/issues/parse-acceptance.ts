import { parseIssueBodyVerifyCommands } from '@goose-hub/core/acceptance-contracts/issue-body.js';

export interface VerifyBlock {
  criterionId: string;
  checkId: string;
  ac: string;
  command: string;
  expectedExitCodes: number[];
  outputExpectation?: {
    mode: 'exact' | 'contains' | 'regex';
    value: string;
  };
  timeoutMs?: number;
}

export const parseAcceptanceCriteria = parseIssueBodyVerifyCommands;
