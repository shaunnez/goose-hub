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
});
