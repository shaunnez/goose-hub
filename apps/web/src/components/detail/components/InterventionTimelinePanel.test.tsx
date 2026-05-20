/** @vitest-environment jsdom */
import { fetchIntervention, fetchIssueInterventions } from '@/lib/api';
import type { InterventionDetailDto } from '@/lib/api/interventions';
import type { InterventionDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterventionTimelinePanel } from './InterventionTimelinePanel';

vi.mock('@/lib/api', () => ({
  fetchIntervention: vi.fn(),
  fetchIssueInterventions: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchIssueInterventions).mockResolvedValue([]);
});

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

function makeIntervention(overrides: Partial<InterventionDto> = {}): InterventionDto {
  return {
    id: 'intervention-123456789',
    projectId: 'proj',
    workItemId: 'github:org/repo#42',
    interventionType: 'needs_human',
    status: 'APPLIED',
    title: 'Human intervention required',
    reason: 'Retry cap hit after 3 attempts.',
    rootCauseSignature: 'needs-human:42',
    correlationId: 'corr-1',
    sourceEventId: 10,
    proposedOptions: [],
    decidedActionType: 'manual_transition',
    decidedActionPayload: {
      from: 'factory:needs-human',
      to: 'factory:dev-ready',
    },
    decidedBy: 'shaun',
    decisionReason: 'Retry implementation',
    applicationResult: { ok: true },
    verification: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    version: 5,
    createdAt: '2026-05-04T10:00:00Z',
    updatedAt: '2026-05-04T10:00:00Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeDetail(intervention = makeIntervention()): InterventionDetailDto {
  return {
    intervention,
    events: [
      {
        id: 1,
        interventionId: intervention.id,
        projectId: 'proj',
        workItemId: intervention.workItemId,
        eventType: 'open',
        actor: 'projector',
        fromStatus: null,
        toStatus: 'OPEN',
        payload: { evidence: { event: 10 } },
        correlationId: 'corr-1',
        createdAt: '2026-05-04T10:00:00Z',
      },
      {
        id: 2,
        interventionId: intervention.id,
        projectId: 'proj',
        workItemId: intervention.workItemId,
        eventType: 'dedupe',
        actor: 'projector',
        fromStatus: 'OPEN',
        toStatus: 'OPEN',
        payload: {},
        correlationId: 'corr-1',
        createdAt: '2026-05-04T10:01:00Z',
      },
      {
        id: 3,
        interventionId: intervention.id,
        projectId: 'proj',
        workItemId: intervention.workItemId,
        eventType: 'decide',
        actor: 'shaun',
        fromStatus: 'PROPOSED',
        toStatus: 'DECIDED',
        payload: { actionType: 'manual_transition' },
        correlationId: 'corr-1',
        createdAt: '2026-05-04T10:02:00Z',
      },
      {
        id: 4,
        interventionId: intervention.id,
        projectId: 'proj',
        workItemId: intervention.workItemId,
        eventType: 'recordApplicationResult',
        actor: 'intervention-applier',
        fromStatus: 'APPLYING',
        toStatus: 'APPLIED',
        payload: { ok: true },
        correlationId: 'corr-1',
        createdAt: '2026-05-04T10:03:00Z',
      },
    ],
  };
}

describe('InterventionTimelinePanel', () => {
  it('renders intervention lifecycle and filters noisy dedupe events', async () => {
    const intervention = makeIntervention();
    vi.mocked(fetchIssueInterventions).mockResolvedValueOnce([intervention]);
    vi.mocked(fetchIntervention).mockResolvedValueOnce(makeDetail(intervention));

    render_(<InterventionTimelinePanel projectSlug="proj" id="42" />);

    await screen.findByTestId('intervention-timeline-panel');
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('Intervention audit');
    expect(rendered).toContain('Human intervention required');
    expect(rendered).toContain('Opened');
    expect(rendered).toContain('Decided');
    expect(rendered).toContain('shaun chose manual transition');
    expect(rendered).toContain('Applied');
    expect(rendered).not.toContain('dedupe');
  });
});
