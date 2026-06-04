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
    runId: '4d53ad88-1faa-49fd-b6f5-8e1bf31a47a9',
    createdAt: '2026-05-14T09:13:44Z',
    workItemId: 'github:shaunnez/goose-hub#522',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('Evidence timeline events', () => {
  it('renders evidence gate skip reason and changed paths', () => {
    const event = makeEvent('evidence.no-spec-declared', {
      reason: 'UI change did not declare an evidence spec',
      changedPaths: [
        'apps/web/src/components/chrome/TopBar.tsx',
        'apps/web/src/components/chrome/TopBar.test.tsx',
        'apps/web/src/components/chrome/shortcut.ts',
        'apps/web/src/components/chrome/extra.ts',
      ],
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Evidence gate skipped')).toBeTruthy();
    expect(document.body.textContent).toContain('UI change did not declare an evidence spec');
    expect(document.body.textContent).toContain('apps/web/src/components/chrome/TopBar.tsx');
    expect(document.body.textContent).toContain('+1 more');
    expect(document.body.textContent).not.toContain('No evidence spec declared');
    expect(document.body.textContent).not.toContain('"changedPaths"');
  });

  it('renders Playwright evidence as summary text instead of raw JSON', () => {
    const event = makeEvent('evidence.playwright-ran', {
      runId: '4d53ad88-1faa-49fd-b6f5-8e1bf31a47a9',
      specPath: 'apps/web/e2e/repro-change-goose-hub-header-3.spec.ts',
      status: 'failed',
      exitCode: 1,
      screenshots: ['apps/web/evidence/issue-522/step-1.png'],
      videos: [],
      errors: ['Error: Process from config.webServer was not able to start. Exit code: 1'],
      phase: 'before',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Playwright failed')).toBeTruthy();
    expect(screen.getByText('apps/web/e2e/repro-change-goose-hub-header-3.spec.ts')).toBeTruthy();
    expect(screen.getByText('phase before')).toBeTruthy();
    expect(screen.getByText('exit 1')).toBeTruthy();
    expect(screen.getByText('run 4d53ad88')).toBeTruthy();
    expect(document.body.textContent).toContain('apps/web/evidence/issue-522/step-1.png');
    expect(document.body.textContent).toContain(
      'Error: Process from config.webServer was not able to start. Exit code: 1',
    );
    expect(document.body.textContent).not.toContain('"specPath"');
  });
});
