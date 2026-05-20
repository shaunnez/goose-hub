/** @vitest-environment jsdom */
import type { InterventionDto, InterventionEventDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InterventionGroupWrapper } from './InterventionGroupWrapper';

afterEach(cleanup);

function makeIntervention(overrides: Partial<InterventionDto> = {}): InterventionDto {
  return {
    id: 'intervention-123456789',
    projectId: 'proj',
    workItemId: 'github:org/repo#42',
    interventionType: 'manual_override',
    status: 'RESOLVED',
    title: 'Manual operator transition',
    reason: 'Operator requested factory:needs-human -> factory:triaging',
    rootCauseSignature: 'manual:42',
    correlationId: 'corr-1',
    sourceEventId: 10,
    proposedOptions: [],
    decidedActionType: 'manual_transition',
    decidedActionPayload: {
      from: 'factory:needs-human',
      to: 'factory:triaging',
    },
    decidedBy: 'shaun',
    decisionReason: 'manual operator transition',
    applicationResult: { ok: true },
    verification: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    version: 5,
    createdAt: '2026-05-04T10:00:00Z',
    updatedAt: '2026-05-04T10:03:00Z',
    resolvedAt: '2026-05-04T10:03:00Z',
    ...overrides,
  };
}

function makeEvent(
  id: number,
  eventType: string,
  overrides: Partial<InterventionEventDto> = {},
): InterventionEventDto {
  return {
    id,
    interventionId: 'intervention-123456789',
    projectId: 'proj',
    workItemId: 'github:org/repo#42',
    eventType,
    actor: 'ui',
    fromStatus: null,
    toStatus: null,
    payload: {},
    correlationId: 'corr-1',
    createdAt: `2026-05-04T10:0${id}:00Z`,
    ...overrides,
  };
}

describe('InterventionGroupWrapper', () => {
  it('renders the intervention summary and timestamped lifecycle events', () => {
    const intervention = makeIntervention();
    const events = [
      makeEvent(1, 'open', { toStatus: 'OPEN' }),
      makeEvent(2, 'decide', {
        fromStatus: 'OPEN',
        toStatus: 'DECIDED',
        payload: { actionType: 'manual_transition' },
      }),
      makeEvent(3, 'recordApplicationResult', {
        fromStatus: 'APPLYING',
        toStatus: 'APPLIED',
        payload: { ok: true },
      }),
    ];

    render(
      <ol>
        <InterventionGroupWrapper
          intervention={intervention}
          events={events}
          startedAt={events[0].createdAt}
          lastEventAt={events[2].createdAt}
          endedAt={intervention.resolvedAt}
        />
      </ol>,
    );

    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('manual override');
    expect(rendered).toContain('RESOLVED');
    expect(rendered).toContain('#interven');
    expect(rendered).toContain('Manual operator transition');
    expect(rendered).toContain('3 events');
    expect(rendered).toContain('Opened');
    expect(rendered).toContain('Decided');
    expect(rendered).toContain('ui chose manual transition');
    expect(rendered).toContain(new Date(events[1].createdAt).toLocaleString());
    expect(screen.getByTestId('intervention-event-recordApplicationResult')).toBeTruthy();
  });
});
