import { describe, expect, it } from 'vitest';
import { classifyQaFailureActionability, collectActionableQaItems } from './actionability.js';

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

  it('does not return needs-fix items for timeout-only broad e2e failures', () => {
    const payload = {
      verificationSummary: {
        changedFiles: { paths: ['apps/web/src/components/chrome/TopBar.tsx'] },
        commands: {
          e2e: {
            command: 'pnpm test:e2e:pipeline',
            status: 'failed',
            error: 'command timed out after 900000ms',
            stderr: 'Timed out while running apps/web/e2e/pipeline/office-capture.spec.ts',
          },
        },
        e2e: {
          command: 'pnpm test:e2e:pipeline',
          status: 'failed',
          reason: 'ui chrome changed',
        },
      },
      findings: [
        {
          tier: 'regression',
          severity: 'error',
          description: 'Pipeline timed out in Office e2e specs',
          disposition: 'needs-fix' as const,
        },
      ],
    };

    expect(classifyQaFailureActionability(payload)).toMatchObject({
      actionable: false,
      classification: 'infrastructure-timeout',
    });
    expect(collectActionableQaItems(payload)).toEqual([]);
  });

  it('keeps broad e2e failures actionable when output names the changed surface', () => {
    const payload = {
      verificationSummary: {
        changedFiles: { paths: ['apps/web/src/components/chrome/TopBar.tsx'] },
        commands: {
          e2e: {
            command: 'pnpm test:e2e:pipeline',
            status: 'failed',
            stderr: 'FAIL apps/web/src/components/chrome/TopBar.tsx shortcut behavior',
          },
        },
      },
      findings: [
        {
          tier: 'functional',
          severity: 'error',
          description: 'TopBar shortcut failed',
          disposition: 'needs-fix' as const,
        },
      ],
    };

    expect(classifyQaFailureActionability(payload)).toMatchObject({
      actionable: true,
      classification: 'issue-local',
    });
    expect(collectActionableQaItems(payload)).toHaveLength(1);
  });

  it('keeps failed executable checks actionable even when broad e2e timed out', () => {
    const payload = {
      verificationSummary: {
        changedFiles: { paths: ['apps/web/src/components/chrome/TopBar.tsx'] },
        commands: {
          test: { command: 'pnpm vitest run TopBar.test.tsx', status: 'passed' },
          e2e: {
            command: 'pnpm test:e2e:pipeline',
            status: 'failed',
            error: 'command timed out after 900000ms',
          },
        },
      },
      criteriaResults: [
        {
          criterionId: 'ac-1',
          checkId: 'shortcut',
          ac: 'Capture shortcut opens Capture',
          command: 'pnpm vitest run TopBar.test.tsx',
          passed: false,
          exitCode: 1,
        },
      ],
    };

    expect(classifyQaFailureActionability(payload)).toMatchObject({
      actionable: true,
      classification: 'issue-local',
    });
    expect(collectActionableQaItems(payload)).toHaveLength(1);
  });
});
