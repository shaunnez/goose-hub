export interface Finding {
  tier: 'structural' | 'functional' | 'regression';
  severity: 'error' | 'warning' | 'info';
  file?: string | null;
  line?: number | null;
  description: string;
  suggestion?: string;
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
  ac: string;
  command: string;
  expected: string;
  actual: string;
  tolerance: string;
  passed: boolean;
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
