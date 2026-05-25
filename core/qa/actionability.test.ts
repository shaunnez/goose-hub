import { describe, expect, it } from 'vitest';
import { collectActionableQaItems } from './actionability.js';

describe('collectActionableQaItems', () => {
  it('treats failed executable checks and needs-fix findings as actionable', () => {
    const items = collectActionableQaItems(
      {
        criteriaResults: [
          {
            criterionId: 'ac-1',
            checkId: 'check-1',
            ac: 'Checkout succeeds',
            command: 'pnpm test checkout.test.ts',
            expectedExitCodes: [0],
            exitCode: 1,
            actual: 'failed',
            passed: false,
          },
        ],
        findings: [
          {
            tier: 'functional',
            severity: 'error',
            description: 'Checkout throws on empty cart',
            disposition: 'needs-fix',
            dispositionRef: 'current PR',
          },
          {
            tier: 'regression',
            severity: 'warning',
            description: 'Unrelated test naming issue',
            disposition: 'out-of-scope',
            dispositionRef: 'Not touched by this PR',
          },
          {
            tier: 'regression',
            severity: 'error',
            description: 'Pre-existing retry flake',
            disposition: 'follow-up',
            dispositionRef: '#123',
          },
        ],
      },
      {
        verifiedFollowUpRefs: new Set(['#123']),
      },
    );

    expect(items.map((item) => item.kind)).toEqual(['criteria-result', 'finding']);
    expect(items.map((item) => item.summary)).toEqual([
      'Executable check failed: Checkout succeeds (pnpm test checkout.test.ts)',
      'Checkout throws on empty cart',
    ]);
  });

  it('treats unverified follow-up findings as actionable', () => {
    const items = collectActionableQaItems({
      findings: [
        {
          tier: 'functional',
          severity: 'error',
          description: 'Missing loading state',
          disposition: 'follow-up',
          dispositionRef: '#999',
        },
      ],
    });

    expect(items).toMatchObject([
      {
        kind: 'finding',
        summary: 'Missing loading state',
        reason: 'unverified-follow-up',
      },
    ]);
  });
});
