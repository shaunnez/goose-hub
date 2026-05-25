export type Disposition = 'fixed' | 'needs-fix' | 'out-of-scope' | 'follow-up';

export interface Finding {
  tier: 'structural' | 'functional' | 'regression';
  severity: 'error' | 'warning' | 'info';
  file?: string | null;
  line?: number | null;
  description: string;
  suggestion?: string;
  disposition?: Disposition;
  dispositionRef?: string;
}

export interface TierResult {
  passed: boolean;
  findings: Finding[];
  command?: string | null;
  output?: string | null;
}

export interface SuiteResult {
  name: string;
  filePath: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  status: 'passed' | 'failed' | 'skipped';
  tests?: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; durationMs: number }>;
}

export interface TestRun {
  wallTimeMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  success: boolean;
  suites: SuiteResult[];
}

export interface CriteriaResult {
  criterionId: string;
  checkId: string;
  ac: string;
  command: string;
  expectedExitCodes: number[];
  exitCode: number | null;
  actual: string;
  passed: boolean;
  outputExpectation?: {
    mode: 'exact' | 'contains' | 'regex';
    value: string;
  };
  evidenceExpectation?:
    | { type: 'exit-code' }
    | { type: 'vitest-json'; suite?: string; testName?: string; expectedStatus: 'passed' };
  evidenceArtifact?: {
    type: 'vitest-json' | 'process';
    summary: { total: number; passed: number; failed: number; skipped: number };
    matchedSuites: string[];
    matchedTests: string[];
    artifactStatus: 'matched' | 'not-found' | 'unavailable';
  };
  durationMs?: number;
  error?: string;
}

export interface QaPayload {
  verdict: 'pass' | 'fail' | 'partial';
  overallScore: number;
  threshold?: number;
  tierResults: {
    structural: TierResult;
    functional: TierResult;
    regression: TierResult;
  };
  findings?: Finding[];
  criteriaResults?: CriteriaResult[];
  testRun?: TestRun;
}

export const TIERS = ['structural', 'functional', 'regression'] as const;

export function formatWallTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function severityColor(sev: Finding['severity']): string {
  if (sev === 'error') return 'var(--danger)';
  if (sev === 'warning') return 'var(--warning)';
  return 'var(--info)';
}
