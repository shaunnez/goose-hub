/** @vitest-environment jsdom */
import { approvePRD, declinePRD, fetchEvents, fetchPRD, revisePRD } from '@/lib/api';
import type { PrdReadModelDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRDSection } from './PRDSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchPRD: vi.fn(),
  fetchEvents: vi.fn(),
  approvePRD: vi.fn(),
  revisePRD: vi.fn(),
  declinePRD: vi.fn(),
}));

const PRD_FIXTURE = {
  title: 'Inline validation in onboarding',
  problem: 'Users drop off at the profile step.',
  proposedSolution: 'Add field-level validation on blur.',
  outOfScope: ['Refactor wizard nav'],
  successCriteria: ['Drop-off decreases ≥ 20%'],
  acceptanceCriteria: [
    { id: 'AC-1', statement: 'Each field validates on blur', journeyId: 'J-1' },
    { id: 'AC-2', statement: 'Events logged to analytics', crossCutting: true },
  ],
  journeys: [
    {
      id: 'J-1',
      persona: 'New user',
      trigger: 'Reaches profile',
      steps: [
        {
          userAction: 'Tabs out of email',
          systemResponse: 'Renders inline error',
          dataShown: 'Error',
          stateChange: 'invalid',
        },
      ],
      successState: 'All fields valid',
      errorStates: [],
      edgeCases: [],
    },
  ],
  functionalSpec: {
    behaviors: [
      {
        when: 'Field loses focus with invalid value',
        given: 'User typed at least one char',
        // biome-ignore lint/suspicious/noThenProperty: PRD FunctionalSpec.behaviors[*].then is the BDD "Then" clause, not Promise#then.
        then: 'Inline error rendered',
      },
    ],
  },
  verticalSlices: [
    {
      title: 'Slice 1: inline validation',
      goal: 'Add validation to onboarding profile step',
      estimatedSize: 'M',
      journeyRefs: ['J-1'],
    },
  ],
  estimatedComplexity: 'medium',
  implementationDecisions: [
    {
      decision: 'Use Zod for client-side validation',
      rationale: 'Matches server-side validation pattern',
      moduleRef: 'apps/web/src/lib/validation.ts',
    },
  ],
  testingDecisions: {
    approach: 'Test that invalid fields show errors on blur',
    modulesToTest: ['slices/onboarding/slice.test.ts'],
    priorArt: 'slices/login/slice.test.ts uses similar blur-validation pattern',
  },
};

function makePRDReadModel(advisor?: string): PrdReadModelDto {
  return {
    prd: PRD_FIXTURE,
    advisorConcerns: advisor ?? null,
    source: 'event',
    createdAt: '2026-05-07T10:00:00Z',
    runId: 'run-1',
  };
}

function makeTestClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function render_(jsx: React.ReactNode) {
  return renderWithClient(jsx, makeTestClient());
}

function renderWithClient(jsx: React.ReactNode, client = makeTestClient()) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>),
  };
}

describe('PRDSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEvents).mockResolvedValue([]);
  });

  it('renders the empty state when no PRD comment is present', async () => {
    vi.mocked(fetchPRD).mockResolvedValueOnce(null);
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-empty-state')).toBeTruthy();
    });
  });

  it('renders Drafting state when state is factory:prd-drafting and no PRD yet', async () => {
    vi.mocked(fetchPRD).mockResolvedValueOnce(null);
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-drafting" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-drafting')).toBeTruthy();
    });
  });

  it('renders title, problem, vertical slices, and complexity badge from PRD comment', async () => {
    vi.mocked(fetchPRD).mockResolvedValueOnce(makePRDReadModel());
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-title').textContent).toBe('Inline validation in onboarding');
    });
    expect(screen.getByTestId('prd-problem').textContent).toContain(
      'Users drop off at the profile step',
    );
    const slices = screen.getAllByTestId('prd-slice');
    expect(slices).toHaveLength(1);
    expect(slices[0].textContent).toContain('Slice 1');
    expect(screen.getByTestId('prd-complexity-badge').textContent).toContain('medium');
  });

  it('renders Advisor notes panel when advisor concerns are present', async () => {
    vi.mocked(fetchPRD).mockResolvedValueOnce(makePRDReadModel('- Quantify the success metric.'));
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-advisor-panel').textContent).toContain('Quantify');
    });
  });

  it('shows Approve, Request Changes, and Decline buttons only when state is factory:prd-review', async () => {
    vi.mocked(fetchPRD).mockResolvedValue(makePRDReadModel());
    const { unmount } = render_(
      <PRDSection projectSlug="proj" id="42" state="factory:prd-review" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('prd-approve-btn')).toBeTruthy();
      expect(screen.getByTestId('prd-request-changes-btn')).toBeTruthy();
      expect(screen.getByTestId('prd-decline-btn')).toBeTruthy();
    });
    expect(screen.getByTestId('prd-approval-controls').textContent).toContain(
      'Approve to route into delivery.',
    );
    expect(screen.getByTestId('prd-approval-controls').textContent).not.toContain(
      'decomposing into vertical slices',
    );
    unmount();

    render_(<PRDSection projectSlug="proj" id="42" state="factory:decomposing" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-section')).toBeTruthy();
    });
    expect(screen.getByTestId('prd-approved-banner').textContent).toContain(
      'decomposing into vertical slices',
    );
    expect(screen.queryByTestId('prd-approve-btn')).toBeNull();
    expect(screen.queryByTestId('prd-request-changes-btn')).toBeNull();
  });

  it('Approve PRD button calls approvePRD API and invalidates issue, event, PRD, and intervention queries', async () => {
    vi.mocked(fetchPRD).mockResolvedValue(makePRDReadModel());
    vi.mocked(approvePRD).mockResolvedValueOnce({ ok: true });
    const queryClient = makeTestClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderWithClient(
      <PRDSection projectSlug="proj" id="42" state="factory:prd-review" />,
      queryClient,
    );
    await waitFor(() => {
      expect(screen.getByTestId('prd-approve-btn')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('prd-approve-btn'));
    await waitFor(() => {
      expect(approvePRD).toHaveBeenCalledWith('proj', '42');
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issue', 'proj', '42'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issues', 'proj'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['prd', 'proj', '42'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['events', 'proj', '42'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['interventions', 'issue', 'proj', '42'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['intervention-timeline', 'proj', '42'],
    });
  });

  it('shows approved/routed copy and hides approval controls for factory:dev-ready', async () => {
    vi.mocked(fetchPRD).mockResolvedValue(makePRDReadModel());
    render_(<PRDSection projectSlug="proj" id="42" state="factory:dev-ready" />);

    await waitFor(() => {
      expect(screen.getByTestId('prd-approved-banner').textContent).toContain('routed to delivery');
    });
    expect(screen.queryByTestId('prd-approval-controls')).toBeNull();
    expect(screen.queryByTestId('prd-approve-btn')).toBeNull();
  });

  it('Request Changes opens the concern form and submits revisePRD', async () => {
    vi.mocked(fetchPRD).mockResolvedValue(makePRDReadModel());
    vi.mocked(revisePRD).mockResolvedValueOnce({ ok: true });
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => expect(screen.getByTestId('prd-request-changes-btn')).toBeTruthy());

    fireEvent.click(screen.getByTestId('prd-request-changes-btn'));
    await waitFor(() => expect(screen.getByTestId('prd-request-changes-form')).toBeTruthy());

    fireEvent.change(screen.getByTestId('prd-concerns-input'), {
      target: { value: 'Journey J-1 is unclear' },
    });
    fireEvent.click(screen.getByTestId('prd-submit-changes-btn'));
    await waitFor(() => {
      expect(revisePRD).toHaveBeenCalledWith('proj', '42', ['Journey J-1 is unclear']);
    });
  });

  it('Decline Feature shows confirmation and calls declinePRD on confirm', async () => {
    vi.mocked(fetchPRD).mockResolvedValue(makePRDReadModel());
    vi.mocked(declinePRD).mockResolvedValueOnce({ ok: true });
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => expect(screen.getByTestId('prd-decline-btn')).toBeTruthy());

    fireEvent.click(screen.getByTestId('prd-decline-btn'));
    await waitFor(() => expect(screen.getByTestId('prd-decline-confirm')).toBeTruthy());

    fireEvent.click(screen.getByTestId('prd-confirm-decline-btn'));
    await waitFor(() => {
      expect(declinePRD).toHaveBeenCalledWith('proj', '42');
    });
  });

  it('renders parse-error state when JSON block is malformed', async () => {
    vi.mocked(fetchPRD).mockResolvedValueOnce({
      prd: null,
      advisorConcerns: null,
      source: 'legacy-comment',
      createdAt: '2026-05-07T10:00:00Z',
      runId: null,
    });
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-parse-error')).toBeTruthy();
    });
  });

  it('renders Implementation Decisions section when present', async () => {
    vi.mocked(fetchPRD).mockResolvedValueOnce(makePRDReadModel());
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-implementation-decisions')).toBeTruthy();
    });
    const decisions = screen.getAllByTestId('prd-impl-decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].textContent).toContain('Use Zod for client-side validation');
    expect(decisions[0].textContent).toContain('apps/web/src/lib/validation.ts');
  });

  it('renders Testing Approach section when present', async () => {
    vi.mocked(fetchPRD).mockResolvedValueOnce(makePRDReadModel());
    render_(<PRDSection projectSlug="proj" id="42" state="factory:prd-review" />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-testing-decisions')).toBeTruthy();
    });
    const section = screen.getByTestId('prd-testing-decisions');
    expect(section.textContent).toContain('Test that invalid fields show errors on blur');
    expect(section.textContent).toContain('slices/onboarding/slice.test.ts');
  });
});
