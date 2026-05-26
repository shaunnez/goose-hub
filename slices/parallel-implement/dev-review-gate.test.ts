import { describe, expect, it } from 'vitest';
import { evaluateDevReviewGate } from './dev-review-gate.js';

const baseFinding = {
  severity: 'P1' as const,
  category: 'correctness' as const,
  file: 'core/a.ts',
  line: 10,
  summary: 'Drops writes',
  suggestion: 'Persist before PR open',
};

describe('evaluateDevReviewGate', () => {
  it('blocks blockers-found verdicts that have no findings to respond to', () => {
    const result = evaluateDevReviewGate({
      latestVerdict: {
        verdict: 'blockers-found',
        findings: [],
        decisionSummaries: [],
      },
      latestResponse: {
        findingDispositions: [],
        decisionSummaries: [{ kind: 'DEV_REVIEW_ADDRESSED', summary: 'No findings' }],
      },
      latestResponseCommit: null,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockerCount: 1,
    });
  });

  it('does not let a lower-severity disposition hide a dismissed P1 on the same line', () => {
    const result = evaluateDevReviewGate({
      latestVerdict: {
        verdict: 'blockers-found',
        findings: [
          baseFinding,
          {
            ...baseFinding,
            severity: 'P3',
            summary: 'Style nit on same line',
            suggestion: 'Optional cleanup',
          },
        ],
        decisionSummaries: [],
      },
      latestResponse: {
        findingDispositions: [
          {
            findingRef: 'core/a.ts:10',
            severity: 'P1',
            disposition: 'dismissed',
            reason: 'Not reproducible',
          },
          {
            findingRef: 'core/a.ts:10',
            severity: 'P3',
            disposition: 'addressed',
          },
        ],
        decisionSummaries: [{ kind: 'DEV_REVIEW_DISMISSED', summary: 'Dismissed P1' }],
      },
      latestResponseCommit: { status: 'committed', sha: 'sha-response' },
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockerCount: 1,
    });
  });
});
