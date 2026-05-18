/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';

afterEach(cleanup);

function makeEvent(payload: unknown): AgentEventDto {
  return {
    id: 1,
    kind: 'symbol-index.hints-used',
    payload,
    runId: 'run-1',
    createdAt: '2026-05-14T02:41:57Z',
    workItemId: 'github:shaunnez/goose-hub#782',
    projectId: 'goose-hub-self',
  };
}

describe('SymbolIndexHintsUsedEvent', () => {
  it('renders symbol-index.hints-used as a card instead of raw JSON', () => {
    const event = makeEvent({
      consumerSkill: 'scout-schema',
      runId: 'run-1',
      offeredHintCount: 4,
      usedHintCount: 2,
      detectionMethod: 'tool-call-path-match',
      usedHints: [
        { name: 'AuthPayload', path: 'skills/auth/schema.ts', source: 'definition' },
        { name: 'dispatchWave', path: 'slices/investigate/workflow.ts', source: 'importer' },
      ],
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Symbol hints used')).toBeTruthy();
    expect(screen.getByText('scout-schema used 2 of 4 offered hints')).toBeTruthy();
    expect(screen.getByText('AuthPayload')).toBeTruthy();
    expect(screen.getByText('skills/auth/schema.ts')).toBeTruthy();
    expect(screen.getByText('· definition')).toBeTruthy();
    expect(screen.getByText('dispatchWave')).toBeTruthy();
    expect(screen.getByText('slices/investigate/workflow.ts')).toBeTruthy();
    expect(screen.getByText('· importer')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"usedHints"');
  });
});
