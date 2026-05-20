import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown, id = 1): AgentEventDto {
  return {
    id,
    kind,
    payload,
    runId: 'e3bb94b3-4bf6-4c93-9407-9a2dc30c760d',
    createdAt: '2026-05-14T02:41:57Z',
    workItemId: 'github:shaunnez/goose-hub#782',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('Misc timeline events', () => {
  it('renders agent.budget-exceeded as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.budget-exceeded', {
      runId: 'e3bb94b3-4bf6-4c93-9407-9a2dc30c760d',
      skill: 'implement',
      modelId: 'gpt-5.4-mini',
      costUsd: 11.234089500000001,
      budgetUsd: 6,
      inputTokens: 14593982,
      outputTokens: 64134,
      overByUsd: 5.23409,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Agent budget exceeded')).toBeTruthy();
    expect(screen.getByText('Spent $11.23')).toBeTruthy();
    expect(screen.getByText('Budget $6.00')).toBeTruthy();
    expect(screen.getByText('Over by $5.23')).toBeTruthy();
    expect(screen.getByText('14.7M tokens (14.6M in / 64k out)')).toBeTruthy();
    expect(screen.getByText('gpt-5.4-mini')).toBeTruthy();
    expect(screen.getByText('implement')).toBeTruthy();
    expect(screen.getByText('run e3bb94b3')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"costUsd"');
  });

  it('renders agent.investigation-context-injected as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.investigation-context-injected', {
      skill: 'implement-wp',
      wpId: 'WP1',
      investigationRunId: 'c8a6cf90-202a-4ee8-a903-04fbbb67ecc2',
      keyFiles: ['apps/server/src/domains/workflows/triage-batch.ts'],
      keyFileCount: 1,
      openQuestionCount: 2,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Investigation context injected')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('implement-wp');
    expect(rendered).toContain('WP1');
    expect(rendered).toContain('1 key file');
    expect(rendered).toContain('2 open questions');
    expect(rendered).toContain('apps/server/src/domains/workflows/triage-batch.ts');
    expect(rendered).not.toContain('"keyFiles"');
  });

  it('renders agent.related-surface-manifest-created as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.related-surface-manifest-created', {
      runId: 'ec9bd51c-5ab2-4b43-9c34-b81b18287fdb',
      skill: 'implement',
      keyFileCount: 3,
      packageRootCount: 1,
      existingTestCount: 1,
      testCandidateCount: 8,
      checkedAbsentCount: 8,
      evidenceSpecPath: 'apps/web/e2e/issue-896.spec.ts',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Related surface manifest')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('implement');
    expect(rendered).toContain('3 key files');
    expect(rendered).toContain('1 existing test');
    expect(rendered).toContain('8 candidates');
    expect(rendered).toContain('8 absent checked');
    expect(rendered).toContain('apps/web/e2e/issue-896.spec.ts');
    expect(rendered).not.toContain('"keyFileCount"');
  });

  it('renders agent.discovery-budget-exceeded as a compact warning', () => {
    const event = makeEvent('agent.discovery-budget-exceeded', {
      runId: 'ec9bd51c-5ab2-4b43-9c34-b81b18287fdb',
      skill: 'implement',
      checkedAbsentCount: 8,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Discovery budget exceeded')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('implement repeated discovery for manifest-resolved paths');
    expect(rendered).toContain('8 absent paths were already checked');
    expect(rendered).toContain('run ec9bd51c');
    expect(rendered).not.toContain('"checkedAbsentCount"');
  });

  it('renders agent.wrong-surface-guard as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.wrong-surface-guard', {
      skill: 'parallel-implement',
      reason: 'engineering-spec-missed-investigation-surface',
      expectedKeyFiles: ['apps/server/src/domains/workflows/triage-batch.ts'],
      touchedPaths: ['slices/parallel-implement/workflow.ts'],
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Wrong surface guard')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('parallel-implement');
    expect(rendered).toContain('engineering-spec-missed-investigation-surface');
    expect(rendered).toContain('apps/server/src/domains/workflows/triage-batch.ts');
    expect(rendered).toContain('slices/parallel-implement/workflow.ts');
    expect(rendered).not.toContain('"expectedKeyFiles"');
  });

  it('renders path-normalized and contract drift events as compact operational facts', () => {
    const normalized = makeEvent(
      'agent.path-normalized',
      {
        skill: 'parallel-implement',
        fields: [
          {
            field: 'workPackages[0].filesOwned[0]',
            from: 'src/Button.tsx',
            to: 'apps/web/src/Button.tsx',
          },
        ],
      },
      11,
    );
    const mismatch = makeEvent(
      'agent.output-fact-mismatch',
      {
        skill: 'implement',
        observedChangedFiles: { count: 1, paths: ['apps/web/src/Button.tsx'] },
        observedWriteFiles: { count: 1, paths: ['apps/web/src/Button.tsx'] },
        modelDeclaredFiles: { count: 1, paths: ['src/Button.tsx'] },
        mismatches: {
          observedNotDeclared: { count: 1, paths: ['apps/web/src/Button.tsx'] },
          declaredNotObserved: { count: 1, paths: ['src/Button.tsx'] },
        },
      },
      12,
    );
    const blocked = makeEvent(
      'agent.contract-gate-blocked',
      {
        skill: 'implement-wp',
        gate: 'implement-wp-ownership',
        reason: 'ambiguous-files-owned',
      },
      13,
    );

    render(
      <ul>
        {renderTimelineItem({ kind: 'event', event: normalized }, 0)}
        {renderTimelineItem({ kind: 'event', event: mismatch }, 1)}
        {renderTimelineItem({ kind: 'event', event: blocked }, 2)}
      </ul>,
    );

    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('Path normalized');
    expect(rendered).toContain('src/Button.tsx');
    expect(rendered).toContain('apps/web/src/Button.tsx');
    expect(rendered).toContain('Operational fact mismatch');
    expect(rendered).toContain('Git observed changed');
    expect(rendered).toContain('Tool observed writes');
    expect(rendered).toContain('Observed not declared');
    expect(rendered).toContain('Contract gate blocked');
    expect(rendered).toContain('ambiguous-files-owned');
    expect(rendered).not.toContain('"observedChangedFiles"');
  });

  it('renders agent.disclosure as summarized input metadata', () => {
    const event = makeEvent('agent.disclosure', {
      kind: 'diff_summarized',
      skill: 'dev-review',
      bytesSaved: 4096,
      artifactKeys: ['pr-diff:abc'],
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Input summarized')).toBeTruthy();
    expect(screen.getByText('diff_summarized')).toBeTruthy();
    expect(screen.getByText('dev-review')).toBeTruthy();
    expect(screen.getByText('pr-diff:abc')).toBeTruthy();
    expect(screen.getByText('4.0 KB saved')).toBeTruthy();
  });

  it('links state transitions back to the intervention that caused them', () => {
    const event = makeEvent('state.transitioned', {
      from: 'factory:needs-human',
      to: 'factory:dev-ready',
      by: 'operator',
      causedByInterventionId: 'intervention-abcdef123456',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('State transitioned')).toBeTruthy();
    expect(screen.getByText('factory:needs-human → factory:dev-ready (by operator)')).toBeTruthy();
    expect(document.body.textContent).toContain('Caused by intervention');
    expect(document.body.textContent).toContain('interven');
  });
});
