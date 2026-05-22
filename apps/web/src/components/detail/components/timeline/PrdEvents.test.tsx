import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PrdDeclinedEvent, PrdLifecycleRoutedEvent, PrdRevisedEvent } from './PrdEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    createdAt: '2026-05-08T10:00:00Z',
    workItemId: 'github:owner/repo#42',
    projectId: 'proj',
  } as AgentEventDto;
}

describe('PrdRevisedEvent', () => {
  it('renders the "PRD revision requested" label', () => {
    render(
      <ul>
        <PrdRevisedEvent
          event={makeEvent('prd.revised', { source: 'ui', concerns: ['Journey J-1 is unclear'] })}
        />
      </ul>,
    );
    expect(screen.getByTestId('prd-revised-event').textContent).toContain('PRD revision requested');
  });

  it('renders concern list', () => {
    render(
      <ul>
        <PrdRevisedEvent
          event={makeEvent('prd.revised', {
            source: 'ui',
            concerns: ['Concern A', 'Concern B'],
          })}
        />
      </ul>,
    );
    const el = screen.getByTestId('prd-revised-event');
    expect(el.textContent).toContain('Concern A');
    expect(el.textContent).toContain('Concern B');
  });

  it('renders without concerns gracefully', () => {
    render(
      <ul>
        <PrdRevisedEvent event={makeEvent('prd.revised', { source: 'ui' })} />
      </ul>,
    );
    expect(screen.getByTestId('prd-revised-event')).toBeTruthy();
  });
});

describe('PrdDeclinedEvent', () => {
  it('renders the "Feature declined" label', () => {
    render(
      <ul>
        <PrdDeclinedEvent event={makeEvent('prd.declined', { source: 'ui' })} />
      </ul>,
    );
    expect(screen.getByTestId('prd-declined-event').textContent).toContain('Feature declined');
  });

  it('renders source when present', () => {
    render(
      <ul>
        <PrdDeclinedEvent event={makeEvent('prd.declined', { source: 'ui' })} />
      </ul>,
    );
    expect(screen.getByTestId('prd-declined-event').textContent).toContain('via ui');
  });
});

describe('PrdLifecycleRoutedEvent', () => {
  it('renders the PRD approval route without falling back to JSON', () => {
    render(
      <ul>
        <PrdLifecycleRoutedEvent
          event={makeEvent('prd.lifecycle-routed', {
            from: 'factory:prd-review',
            to: 'factory:dev-ready',
            skipped: 'decompose-issues',
            next: 'spec-author',
            source: 'ui',
            discoverSessionId: 'b2bf4343-8dd1-4364-9c3e-7b33f0d0077c',
          })}
        />
      </ul>,
    );

    const el = screen.getByTestId('prd-lifecycle-routed-event');
    expect(el.textContent).toContain('PRD routed to delivery');
    expect(el.textContent).toContain('factory:prd-review');
    expect(el.textContent).toContain('factory:dev-ready');
    expect(el.textContent).toContain('Next spec-author');
    expect(el.textContent).toContain('Skipped decompose-issues');
    expect(el.textContent).toContain('via ui');
    expect(el.textContent).toContain('b2bf4343');
    expect(el.textContent).not.toContain('"discoverSessionId"');
  });
});
