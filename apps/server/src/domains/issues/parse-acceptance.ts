import { parseIssueBodyVerifyCommands } from '@goose-hub/core/acceptance-contracts/issue-body.js';

export interface VerifyBlock {
  ac: string;
  command: string;
  expected: string;
  tolerance: string;
}

export const parseAcceptanceCriteria = parseIssueBodyVerifyCommands;
