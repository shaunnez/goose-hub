/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentModelSelectedEvent } from './AgentModelSelectedEvent';

afterEach(cleanup);

describe('AgentModelSelectedEvent', () => {
  it('renders with icon, label, and timestamp', () => {
    const event: AgentEventDto = {
      id: 1,
      projectId: 'proj',
      workItemId: 'wi-1',
      kind: 'agent.model-selected',
      payload: {
        runId: 'cef34921-290b-4c2b-a16c-9800fe1cdfa9',
        role: 'developer',
        selectedTier: 'haiku',
        reason: 'type-chore',
      },
      createdAt: new Date('2026-05-09T10:45:14Z').toISOString(),
    };

    const { container } = render(<AgentModelSelectedEvent event={event} />);

    expect(screen.getByText('Model selected')).toBeDefined();
    expect(screen.getByText('developer')).toBeDefined();
    expect(screen.getByText('haiku')).toBeDefined();
    expect(screen.getByText('type-chore')).toBeDefined();
    expect(container.querySelector('[data-event-kind="agent.model-selected"]')).toBeDefined();
  });

  it('renders with all payload fields when present', () => {
    const event: AgentEventDto = {
      id: 1,
      projectId: 'proj',
      workItemId: 'wi-1',
      kind: 'agent.model-selected',
      payload: {
        runId: 'run-123',
        role: 'qa',
        selectedTier: 'opus',
        reason: 'critical-issue',
      },
      createdAt: new Date().toISOString(),
    };

    render(<AgentModelSelectedEvent event={event} />);

    expect(screen.getByText('qa')).toBeDefined();
    expect(screen.getByText('opus')).toBeDefined();
    expect(screen.getByText('critical-issue')).toBeDefined();
  });

  it('renders gracefully with minimal payload', () => {
    const event: AgentEventDto = {
      id: 1,
      projectId: 'proj',
      workItemId: 'wi-1',
      kind: 'agent.model-selected',
      payload: {},
      createdAt: new Date().toISOString(),
    };

    const { container } = render(<AgentModelSelectedEvent event={event} />);

    expect(screen.getByText('Model selected')).toBeDefined();
    expect(container.querySelector('[data-event-kind="agent.model-selected"]')).toBeDefined();
  });
});
