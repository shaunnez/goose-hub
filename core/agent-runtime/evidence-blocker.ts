import type { z } from 'zod';
import type { DecisionSummarySchema } from '../retrospective/schemas.js';

type DecisionSummary = z.infer<typeof DecisionSummarySchema>;

const EVIDENCE_BLOCKER_KINDS = new Set(['TOOL_FAILURE', 'UNCERTAINTY', 'SKIP_GATE']);
const EVIDENCE_CONTEXT_RE = /\b(e2e|evidence|playwright)\b/i;
const BLOCKER_CONTEXT_RE =
  /\b(block\w*|fail\w*|unclear|disabled|setting|skip\w*|not applicable|no spec|absent|unavailable|not received|not provided)\b/i;

export function hasEvidenceBlockerDecision(summaries: readonly DecisionSummary[]): boolean {
  return summaries.some((summary) => {
    if (!EVIDENCE_BLOCKER_KINDS.has(summary.kind)) return false;
    const text = `${summary.summary} ${summary.evidence ?? ''}`;
    if (!EVIDENCE_CONTEXT_RE.test(text)) return false;
    if (summary.kind === 'SKIP_GATE') return true;
    return BLOCKER_CONTEXT_RE.test(text);
  });
}
