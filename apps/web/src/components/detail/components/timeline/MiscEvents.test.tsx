import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentModelSelectedEvent } from './MiscEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    createdAt: '2026-05-09T10:45:14Z',
    workItemId: 'github:owner/repo#42',
    projectId: 'proj',
  } as AgentEventDto;
}

describe('AgentModelSelectedEvent', () => {
  it('renders Model selected label', () => {
    render(
      <ul>
        <AgentModelSelectedEvent
          event={makeEvent('agent.model-selected', {
            runId: 'cef34921-290b-4c2b-a16c-9800fe1cdfa9',
            role: 'developer',
            selectedTier: 'haiku',
            reason: 'type-chore',
          })}
        />
      </ul>,
    );
    expect(screen.getByText('Model selected')).toBeTruthy();
  });

  it('renders selectedTier and reason', () => {
    const { container } = render(
      <ul>
        <AgentModelSelectedEvent
          event={makeEvent('agent.model-selected', {
            runId: 'cef34921-290b-4c2b-a16c-9800fe1cdfa9',
            role: 'developer',
            selectedTier: 'haiku',
            reason: 'type-chore',
          })}
        />
      </ul>,
    );
    const li = container.querySelector('[data-event-kind="agent.model-selected"]');
    expect(li?.textContent).toContain('haiku');
    expect(li?.textContent).toContain('type-chore');
  });

  it('renders with fallback values when tier is missing', () => {
    const { container } = render(
      <ul>
        <AgentModelSelectedEvent
          event={makeEvent('agent.model-selected', {
            runId: 'cef34921-290b-4c2b-a16c-9800fe1cdfa9',
            role: 'developer',
            reason: 'type-chore',
          })}
        />
      </ul>,
    );
    const li = container.querySelector('[data-event-kind="agent.model-selected"]');
    expect(li?.textContent).toContain('—');
    expect(li?.textContent).toContain('type-chore');
  });

  it('has data-event-kind attribute', () => {
    const { container } = render(
      <ul>
        <AgentModelSelectedEvent
          event={makeEvent('agent.model-selected', {
            runId: 'cef34921-290b-4c2b-a16c-9800fe1cdfa9',
            role: 'developer',
            selectedTier: 'haiku',
            reason: 'type-chore',
          })}
        />
      </ul>,
    );
    const li = container.querySelector('[data-event-kind="agent.model-selected"]');
    expect(li).toBeTruthy();
  });

  it('does not render raw JSON in pre tag', () => {
    const { container } = render(
      <ul>
        <AgentModelSelectedEvent
          event={makeEvent('agent.model-selected', {
            runId: 'cef34921-290b-4c2b-a16c-9800fe1cdfa9',
            role: 'developer',
            selectedTier: 'haiku',
            reason: 'type-chore',
          })}
        />
      </ul>,
    );
    const preTags = container.querySelectorAll('pre');
    expect(preTags).toHaveLength(0);
  });
});
