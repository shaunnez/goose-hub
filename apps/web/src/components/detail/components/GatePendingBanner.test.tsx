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

  it('does not render or fetch interventions for archived issues', async () => {
    vi.mocked(fetchIssueInterventions).mockResolvedValue([
      makeIntervention({ title: 'Issue moved to needs-human' }),
    ]);

    render_(<GatePendingBanner state="factory:archived" projectSlug="proj" id="42" />);

    expect(screen.queryByTestId('gate-pending-banner')).toBeNull();
    expect(fetchIssueInterventions).not.toHaveBeenCalled();
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

  it('fetches interventions when the issue lifecycle changes into a gate state', async () => {
    vi.mocked(fetchIssueInterventions).mockResolvedValueOnce([
      makeIntervention({ title: 'Issue moved to needs-human' }),
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <GatePendingBanner state="factory:needs-qa" projectSlug="proj" id="42" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('gate-pending-banner')).toBeNull();
    expect(fetchIssueInterventions).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByText('Issue moved to needs-human');
    expect(fetchIssueInterventions).toHaveBeenCalledTimes(1);
  });

  it('submits a proposed option with the intervention version as CAS', async () => {
    const onTransitioned = vi.fn();
    const intervention = makeIntervention();
    vi.mocked(fetchIssueInterventions).mockResolvedValue([intervention]);

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
    const intervention = makeIntervention({
      status: 'OPEN',
      proposedOptions: [],
      leaseOwner: null,
      version: 3,
    });
    vi.mocked(fetchIssueInterventions).mockResolvedValue([intervention]);
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

  it('refreshes instead of deciding a stale OPEN intervention that became PROPOSED', async () => {
    const staleOpen = makeIntervention({
      status: 'OPEN',
      title: 'Issue moved to needs-human',
      proposedOptions: [],
      leaseOwner: null,
      version: 8,
    });
    const proposed = makeIntervention({
      status: 'PROPOSED',
      title: 'Issue moved to needs-human',
      proposedOptions: [
        {
          actionType: 'manual_transition',
          label: 'Return to dev-ready after fixing Playwright',
          description: 'Use this once the dependency problem has been fixed.',
          payload: {
            from: 'factory:needs-human',
            to: 'factory:dev-ready',
            reason: 'retry implementation',
          },
          risk: 'low',
        },
      ],
      version: 10,
    });
    vi.mocked(fetchIssueInterventions)
      .mockResolvedValueOnce([staleOpen])
      .mockResolvedValueOnce([proposed]);
    vi.mocked(fetchLegalTargets).mockResolvedValueOnce({
      from: 'factory:needs-human',
      legalTargets: ['factory:dev-ready'],
    });

    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);

    fireEvent.click(await screen.findByTestId('gate-action-manual-factory-dev-ready'));

    await screen.findByText('Return to dev-ready after fixing Playwright');
    expect(decideIntervention).not.toHaveBeenCalled();
    expect(screen.queryByText(/version conflict/i)).toBeNull();
  });

  it('refetches active interventions after a decision version conflict', async () => {
    const intervention = makeIntervention({ version: 8 });
    const refreshed = makeIntervention({
      version: 10,
      proposedOptions: [
        {
          actionType: 'manual_transition',
          label: 'Return with latest proposal',
          description: 'Use the latest proposal.',
          payload: {
            from: 'factory:needs-human',
            to: 'factory:dev-ready',
            reason: 'retry implementation',
          },
          risk: 'low',
        },
      ],
    });
    vi.mocked(fetchIssueInterventions)
      .mockResolvedValueOnce([intervention])
      .mockResolvedValueOnce([intervention])
      .mockResolvedValueOnce([refreshed]);
    vi.mocked(decideIntervention).mockRejectedValueOnce(
      new Error(
        'POST /interventions/int-1/decide failed: 409 Conflict {"error":"intervention version conflict"}',
      ),
    );

    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);

    fireEvent.click(await screen.findByTestId('gate-action-option-0'));

    await screen.findByText('Return with latest proposal');
    expect(decideIntervention).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/409 Conflict/i)).toBeNull();
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

  it('renders PRD-review interventions with a Review PRD navigation action only', async () => {
    vi.mocked(fetchIssueInterventions).mockResolvedValueOnce([
      makeIntervention({
        interventionType: 'prd_review',
        status: 'OPEN',
        title: 'PRD review required',
        reason: 'Approve, request changes, or decline the PRD to continue.',
        proposedOptions: [],
      }),
    ]);

    render_(<GatePendingBanner state="factory:prd-review" projectSlug="proj" id="42" />);

    await screen.findByText('PRD review required');
    expect(screen.getByTestId('escalation-reason').textContent).toContain(
      'Approve, request changes, or decline',
    );
    expect(screen.getByTestId('gate-action-review-prd').getAttribute('href')).toBe(
      '/projects/proj/items/42/prd',
    );
    expect(screen.queryByTestId('gate-action-option-0')).toBeNull();
    expect(fetchLegalTargets).not.toHaveBeenCalled();
  });
});
