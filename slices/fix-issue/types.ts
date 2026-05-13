import type { DecisionSummary } from '@goose-hub/core/agent-runtime/interface.js';

export interface ImplementOutputShape {
  plan: string;
  filesWritten: { path: string; reason: string }[];
  testsWritten: { path: string; cases: number }[];
  testsRun: { command: string; paths: string[] };
  prUrl: string;
  evidenceSpecPath: string | null;
  confidence: 'low' | 'medium' | 'high';
  decisionSummaries: DecisionSummary[];
}
