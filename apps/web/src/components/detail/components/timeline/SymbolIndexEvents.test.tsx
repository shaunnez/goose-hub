/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';

afterEach(cleanup);

function makeEvent(payload: unknown, kind = 'symbol-index.hints-used'): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    runId: 'run-1',
    createdAt: '2026-05-14T02:41:57Z',
    workItemId: 'github:shaunnez/goose-hub#782',
    projectId: 'goose-hub-self',
  };
}

describe('SymbolIndexLookupEvent', () => {
  it('renders symbol-index.lookup as a useful summary instead of raw JSON', () => {
    const event = makeEvent(
      {
        consumerSkill: 'scout-code-path',
        identifierCount: 10,
        hintCount: 0,
        rawHintCount: 0,
        consumerHintCounts: {
          'scout-code-path': 0,
          'scout-dependency': 0,
          'scout-schema': 0,
          'scout-test-inventory': 0,
        },
        dbAgeMs: 21_879_393.627685547,
        stale: false,
      },
      'symbol-index.lookup',
    );

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Symbol index lookup')).toBeTruthy();
    expect(
      screen.getByText('Scout Code Path looked up 10 identifiers and found 0 usable hints'),
    ).toBeTruthy();
    expect(screen.getByText('Identifiers')).toBeTruthy();
    expect(screen.getByText('This scout')).toBeTruthy();
    expect(screen.getByText('Raw hints')).toBeTruthy();
    expect(screen.getByText('Index age')).toBeTruthy();
    expect(document.body.textContent).toContain('6h 4m · Fresh');
    expect(document.body.textContent).toContain('scout-code-path: 0');
    expect(document.body.textContent).toContain('scout-test-inventory: 0');
    expect(screen.getByText('No scout received symbol hints.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"consumerHintCounts"');
  });
});

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
