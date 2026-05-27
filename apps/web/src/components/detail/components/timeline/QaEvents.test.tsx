import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    runId: '72c46751-dc12-4c73-baba-c46e9933787b',
    createdAt: '2026-05-14T04:46:39Z',
    workItemId: 'github:shaunnez/goose-hub#783',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('QA timeline events', () => {
  it('renders named tier pass payloads with tierNumber', () => {
    const event = makeEvent('qa.structural-passed', {
      tier: 'structural',
      tierNumber: 1,
      evidence: ['file-exists: src/index.ts (WP WP1)'],
      findingCount: 0,
      runId: '0eca3ecb-034d-4467-8573-7c691ec8b6e2',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('QA Structural passed')).toBeTruthy();
    expect(screen.getByText('0 findings')).toBeTruthy();
    expect(screen.getByText('file-exists: src/index.ts (WP WP1)')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"tierNumber"');
  });

  it('renders numeric tier pass payloads as named QA tiers', () => {
    const event = makeEvent('qa.functional-passed', {
      tier: 2,
      evidence: ['no-verification-tooling-declared'],
      findingCount: 0,
      runId: '0eca3ecb-034d-4467-8573-7c691ec8b6e2',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('QA Functional passed')).toBeTruthy();
    expect(screen.getByText('0 findings')).toBeTruthy();
    expect(screen.getByText('no-verification-tooling-declared')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"tier"');
  });

  it('renders numeric tier failed payloads as named QA tiers', () => {
    const event = makeEvent('qa.regression-failed', {
      tier: 3,
      evidence: ['carry-forward-ok-wps: WP1'],
      findingCount: 1,
      failureCategory: 'regression-unrelated',
      runId: '0eca3ecb-034d-4467-8573-7c691ec8b6e2',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('QA Regression failed')).toBeTruthy();
    expect(screen.getByText('Regression Unrelated')).toBeTruthy();
    expect(screen.getByText('1 finding')).toBeTruthy();
    expect(screen.getByText('carry-forward-ok-wps: WP1')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"tier"');
  });

  it('renders verification summary telemetry as status rows instead of raw JSON', () => {
    const event = makeEvent('qa.verification-summary-built', {
      changedFileCount: 2,
      diffCharCount: 2319,
      contextByteSizeEstimate: 1478,
      lintStatus: 'passed',
      typecheckStatus: 'passed',
      testStatus: 'failed',
      e2eStatus: 'skipped',
      evidenceStatus: 'skipped',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('QA verification summary built')).toBeTruthy();
    expect(screen.getByText('2 files changed')).toBeTruthy();
    expect(screen.getByText('2.3k diff chars')).toBeTruthy();
    expect(screen.getByText('1.4 KB context')).toBeTruthy();
    expect(screen.getByText('Lint')).toBeTruthy();
    expect(screen.getByText('Typecheck')).toBeTruthy();
    expect(screen.getByText('Tests')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getAllByText('skipped')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('"changedFileCount"');
  });

  it('renders fix-feedback completion payloads without raw JSON', () => {
    const event = makeEvent('agent.fix-feedback-complete', {
      filesWritten: 3,
      testsWritten: 2,
      confidence: 'low',
      testsRun: {
        command: 'pnpm test --reporter=json src/components/chrome/slice.test.ts',
        paths: ['src/components/chrome/slice.test.ts'],
      },
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Fix feedback complete')).toBeTruthy();
    expect(screen.getByText('3 files written')).toBeTruthy();
    expect(screen.getByText('2 tests written')).toBeTruthy();
    expect(screen.getByText('low confidence')).toBeTruthy();
    expect(
      screen.getByText('pnpm test --reporter=json src/components/chrome/slice.test.ts'),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('"filesWritten"');
  });

  it('labels legacy implement repair cycles without claiming WP repair', () => {
    const event = makeEvent('agent.fix-feedback-complete', {
      repairMode: 'legacy-implement',
      repairCycle: 1,
      pipelineRunId: 'pipe-123',
      sourceFailureKind: 'qa',
      sourceFailureRunId: 'qa-run-1',
      filesWritten: 1,
      testsWritten: 0,
      confidence: 'medium',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Legacy Repair Cycle 1')).toBeTruthy();
    expect(screen.getByText('legacy implement repair')).toBeTruthy();
    expect(document.body.textContent).not.toContain('WP Repair');
    expect(document.body.textContent).not.toContain('"repairMode"');
  });

  it('only names affected WPs when affectedWpIds exists', () => {
    const event = makeEvent('agent.fix-feedback-complete', {
      repairMode: 'legacy-implement',
      repairCycle: 2,
      affectedWpIds: ['WP2'],
      filesWritten: 1,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('WP2')).toBeTruthy();
  });

  it('renders retry escalation payloads without raw JSON', () => {
    const event = makeEvent('agent.retry-escalated', {
      stage: 'qa',
      maxRetries: 2,
      runId: '7684da8c-b792-4318-94a5-10dfb2218bf4',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Retry cap reached')).toBeTruthy();
    expect(screen.getByText('Stage qa')).toBeTruthy();
    expect(screen.getByText('Max retries 2')).toBeTruthy();
    expect(screen.getByText('run 7684da8c')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"maxRetries"');
  });

  it('renders qa.completed failure category badges', () => {
    const event = makeEvent('qa.completed', {
      verdict: 'fail',
      overallScore: 40,
      threshold: 70,
      failureCategory: 'product',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('QA completed')).toBeTruthy();
    expect(screen.getByText('Product')).toBeTruthy();
  });

  it('labels regression tier as a suite and surfaces the actual command', () => {
    const event = makeEvent('qa.completed', {
      verdict: 'fail',
      overallScore: 40,
      threshold: 70,
      tierResults: {
        structural: { passed: true, findings: [] },
        functional: { passed: true, findings: [] },
        regression: {
          passed: false,
          command: 'pnpm --filter @goose-hub/web test:e2e:pipeline',
          findings: [],
        },
      },
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Regression suite')).toBeTruthy();
    expect(screen.getByText('pnpm --filter @goose-hub/web test:e2e:pipeline')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Regression (playwright)');
  });

  it('renders verification-blocked failure category badges', () => {
    const event = makeEvent('qa.verification-blocked', {
      failedTier: 2,
      reason: 'malformed-verification-command',
      agentSkipped: true,
      failureCategory: 'orchestration',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('QA verification blocked')).toBeTruthy();
    expect(screen.getByText('Orchestration')).toBeTruthy();
  });
});
