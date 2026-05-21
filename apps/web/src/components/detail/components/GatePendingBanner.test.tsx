/** @vitest-environment jsdom */
import { decideIntervention, fetchIssueInterventions, fetchLegalTargets } from '@/lib/api';
import type { InterventionDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatePendingBanner } from './GatePendingBanner';

vi.mock('@/lib/api', () => ({
  decideIntervention: vi.fn(),
  fetchIssueInterventions: vi.fn(),
  fetchLegalTargets: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchIssueInterventions).mockResolvedValue([]);
  vi.mocked(fetchLegalTargets).mockResolvedValue({
    from: 'factory:needs-human',
    legalTargets: ['factory:dev-ready'],
  });
  vi.mocked(decideIntervention).mockResolvedValue({
    intervention: makeIntervention({ status: 'DECIDED' }),
    events: [],
  });
});

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{jsx}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function makeIntervention(overrides: Partial<InterventionDto> = {}): InterventionDto {
  return {
    id: 'int-1',
    projectId: 'proj',
    workItemId: 'github:org/repo#42',
    interventionType: 'needs_human',
    status: 'PROPOSED',
    title: 'Human intervention required',
    reason: 'Retry cap hit after 3 attempts on implement skill',
    rootCauseSignature: 'needs-human:42',
    correlationId: 'corr-1',
    sourceEventId: 10,
    proposedOptions: [
      {
        actionType: 'manual_transition',
        label: 'Send to dev',
        description: 'Move the issue back to implementation.',
        payload: {
          from: 'factory:needs-human',
          to: 'factory:dev-ready',
          reason: 'retry implementation',
        },
        risk: 'medium',
      },
    ],
    decidedActionType: null,
    decidedActionPayload: null,
    decidedBy: null,
    decisionReason: null,
    applicationResult: null,
    verification: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    version: 7,
    createdAt: '2026-05-04T10:00:00Z',
    updatedAt: '2026-05-04T10:00:00Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('GatePendingBanner', () => {
  it('renders nothing when the issue has no active interventions', async () => {
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);

    await waitFor(() => expect(fetchIssueInterventions).toHaveBeenCalled());
    expect(screen.queryByTestId('gate-pending-banner')).toBeNull();
  });

  it('renders durable intervention title and reason instead of gate-state text', async () => {
    vi.mocked(fetchIssueInterventions).mockResolvedValueOnce([
      makeIntervention({
        title: 'Operator decision needed',
        reason: 'QA and builder disagree on evidence readiness.',
      }),
    ]);

    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);

    await screen.findByText('Operator decision needed');
    expect(screen.getByTestId('escalation-reason').textContent).toContain(
      'QA and builder disagree',
    );
    expect(screen.queryByText('Human intervention required')).toBeNull();
  });

  it('refetches interventions when the issue lifecycle state changes', async () => {
    vi.mocked(fetchIssueInterventions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeIntervention({ title: 'Issue moved to needs-human' })]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <GatePendingBanner state="factory:needs-qa" projectSlug="proj" id="42" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetchIssueInterventions).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('gate-pending-banner')).toBeNull();

    rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByText('Issue moved to needs-human');
    expect(fetchIssueInterventions).toHaveBeenCalledTimes(2);
  });

  it('submits a proposed option with the intervention version as CAS', async () => {
    const onTransitioned = vi.fn();
    const intervention = makeIntervention();
    vi.mocked(fetchIssueInterventions).mockResolvedValueOnce([intervention]);

    render_(
      <GatePendingBanner
        state="factory:needs-human"
        projectSlug="proj"
        id="42"
        onTransitioned={onTransitioned}
      />,
    );

    fireEvent.click(await screen.findByTestId('gate-action-option-0'));

    await waitFor(() => {
      expect(decideIntervention).toHaveBeenCalledWith('int-1', {
        actionType: 'manual_transition',
        actionPayload: intervention.proposedOptions[0]?.payload,
        expectedVersion: 7,
        decidedBy: 'operator',
        reason: 'Move the issue back to implementation.',
      });
    });
    expect(onTransitioned).toHaveBeenCalled();
  });

  it('renders legal-target fallback for OPEN interventions and decides manual transition', async () => {
    vi.mocked(fetchIssueInterventions).mockResolvedValueOnce([
      makeIntervention({
        status: 'OPEN',
        proposedOptions: [],
        leaseOwner: null,
        version: 3,
      }),
    ]);
    vi.mocked(fetchLegalTargets).mockResolvedValueOnce({
      from: 'factory:needs-human',
      legalTargets: ['factory:needs-qa', 'factory:triaging'],
    });

    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);

    await screen.findByText('Proposal pending');
    expect(await screen.findByTestId('gate-action-send-to-qa')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('gate-action-manual-factory-triaging'));

    await waitFor(() => {
      expect(decideIntervention).toHaveBeenCalledWith('int-1', {
        actionType: 'manual_transition',
        actionPayload: {
          from: 'factory:needs-human',
          to: 'factory:triaging',
          reason: 'operator selected legal target',
        },
        expectedVersion: 3,
        decidedBy: 'operator',
        reason: 'manual fallback from intervention banner',
      });
    });
  });

  it('does not render Grill as a generic gate-pending intervention action', async () => {
    vi.mocked(fetchIssueInterventions).mockResolvedValueOnce([
      makeIntervention({
        interventionType: 'gate_pending',
        title: 'Question ready',
        reason: 'A grillee answer is needed before PRD.',
        proposedOptions: [],
      }),
    ]);

    render_(<GatePendingBanner state="factory:gate-pending" projectSlug="proj" id="42" />);

    const banner = await screen.findByTestId('gate-pending-banner');
    expect(banner.getAttribute('data-variant')).toBe('info');
    expect(screen.queryByTestId('gate-action-grill')).toBeNull();
  });
});
