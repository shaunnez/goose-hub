export interface CriterionCheck {
  criterion: string;
  status: 'met' | 'unmet' | 'unclear';
  notes?: string;
}

export type ReviewDisposition = 'fixed' | 'registered' | 'out-of-scope';

export interface ReviewFinding {
  criterion?: string;
  severity: 'blocker' | 'major' | 'minor';
  description: string;
  suggestion?: string;
  file?: string;
  line?: number;
  disposition?: ReviewDisposition;
  dispositionRef?: string;
}

export type ReviewVerdict = 'approved' | 'needs-fix' | 'needs-human';

export interface ReviewPayload {
  verdict: ReviewVerdict;
  confidence: number;
  criteriaChecks: CriterionCheck[];
  findings: ReviewFinding[];
  escalationReason?: string;
}

export const DISPOSITION_COLOR: Record<ReviewDisposition, string> = {
  fixed: 'bg-green-500/15 text-green-400',
  registered: 'bg-sky-500/15 text-sky-400',
  'out-of-scope': 'bg-gray-500/15 text-gray-400',
};

export const SEVERITY_COLOR: Record<string, string> = {
  blocker: 'bg-red-500/15 text-red-400',
  major: 'bg-orange-500/15 text-orange-400',
  minor: 'bg-gray-500/15 text-gray-400',
};

export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'Approved',
  'needs-fix': 'Needs fix',
  'needs-human': 'Needs human',
};

export function formatDisposition(d: ReviewDisposition, ref?: string): string {
  if (d === 'fixed') return 'fixed';
  if (d === 'out-of-scope') return 'out-of-scope';
  return ref != null && ref.length > 0
    ? `registered ${ref.startsWith('#') ? ref : `#${ref}`}`
    : 'registered';
}
