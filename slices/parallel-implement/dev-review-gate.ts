import type { DevReviewResponseOutput } from '@goose-hub/skills/dev-review-response/schema.js';
import type { DevReviewFinding, DevReviewOutput } from '@goose-hub/skills/dev-review/schema.js';

type DevReviewResponseCommit =
  | { status: 'committed'; sha: string }
  | { status: 'no-changes' }
  | null;

export type DevReviewGateInput = {
  latestVerdict: DevReviewOutput | null;
  latestResponse: DevReviewResponseOutput | null;
  latestResponseCommit: DevReviewResponseCommit;
  failureReason?: string;
};

export type DevReviewGateResult =
  | { status: 'clear' }
  | { status: 'blocked'; reason: string; blockerCount: number };

function findingRef(finding: DevReviewFinding): string {
  return `${finding.file}:${finding.line}`;
}

function isHighSeverity(severity: string): boolean {
  return severity === 'P0' || severity === 'P1';
}

export function evaluateDevReviewGate(input: DevReviewGateInput): DevReviewGateResult {
  if (input.failureReason != null) {
    return { status: 'blocked', reason: input.failureReason, blockerCount: 1 };
  }

  const verdict = input.latestVerdict;
  if (verdict == null || verdict.verdict === 'no-blockers') return { status: 'clear' };

  if (verdict.verdict === 'inconclusive') {
    return {
      status: 'blocked',
      reason: 'Dev review ended inconclusive; human review required before PR open.',
      blockerCount: Math.max(1, verdict.findings.length),
    };
  }

  const response = input.latestResponse;
  if (response == null) {
    return {
      status: 'blocked',
      reason: 'Dev review found blockers but no response was recorded.',
      blockerCount: verdict.findings.length,
    };
  }

  const dispositionsByRef = new Map(response.findingDispositions.map((d) => [d.findingRef, d]));
  const missingResponse = verdict.findings.filter(
    (finding) => !dispositionsByRef.has(findingRef(finding)),
  );
  if (missingResponse.length > 0) {
    return {
      status: 'blocked',
      reason: `Dev review response did not cover ${missingResponse.length} finding(s).`,
      blockerCount: missingResponse.length,
    };
  }

  const dismissedHighSeverity = verdict.findings.filter((finding) => {
    const disposition = dispositionsByRef.get(findingRef(finding));
    return isHighSeverity(finding.severity) && disposition?.disposition === 'dismissed';
  });
  if (dismissedHighSeverity.length > 0) {
    const severities = [...new Set(dismissedHighSeverity.map((finding) => finding.severity))].join(
      '/',
    );
    return {
      status: 'blocked',
      reason: `${severities} dev-review finding(s) were dismissed; human review required before PR open.`,
      blockerCount: dismissedHighSeverity.length,
    };
  }

  const addressed = response.findingDispositions.filter((d) => d.disposition === 'addressed');
  if (addressed.length > 0 && input.latestResponseCommit?.status !== 'committed') {
    return {
      status: 'blocked',
      reason: 'Dev review response addressed findings but produced no response commit.',
      blockerCount: addressed.length,
    };
  }

  return { status: 'clear' };
}
